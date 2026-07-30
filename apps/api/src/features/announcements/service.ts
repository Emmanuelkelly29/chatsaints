import type { AnnouncementScope } from "../../generated/prisma/enums";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import type { AuthenticatedUser } from "../../middleware/auth";
import { notFound } from "../../middleware/errorHandler";
import { notifyUsers, preview } from "../notifications/service";
import { resolveSenderScope, rolesForAudiences, scopeFilter, type AudienceKey } from "./audience";
import type { CreateAnnouncementInput, EditAnnouncementInput } from "./schemas";

/**
 * Leadership announcements, fanned out to a recipient row per user.
 *
 * Deleted on the way over: the module used to run
 * `ALTER TABLE announcements ADD COLUMN IF NOT EXISTS audience TEXT ...` at
 * import time with `.catch(() => {})`. Application code does not own the schema,
 * migrations do, and a swallowed DDL error is a schema that silently disagrees
 * with the code that depends on it. `audience` is now a real `text[]` declared in
 * prisma/schema.prisma and read and written as an array, with no JSON.parse in
 * sight.
 */

/** Keeps a single INSERT well under Postgres' bind-parameter ceiling. */
const RECIPIENT_CHUNK = 1_000;

/** Recipients drop off the "recent" list a day after they read them. */
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

const ANNOUNCEMENT_SELECT = {
  id: true,
  title: true,
  body: true,
  scope: true,
  scopeId: true,
  audience: true,
  createdAt: true,
  updatedAt: true,
} as const;

const SENDER_SELECT = {
  id: true,
  fullName: true,
  role: true,
  profilePhotoUrl: true,
} as const;

// ─── Send ───────────────────────────────────────────────────────────────────

export interface CreateAnnouncementResult {
  announcement: {
    id: string;
    title: string;
    body: string;
    scope: AnnouncementScope;
    scopeId: string | null;
    audience: string[];
    createdAt: Date;
  };
  recipientCount: number;
}

/**
 * Recipient ids for a scope and audience.
 *
 * Suspended accounts are excluded, and the sender never receives their own
 * announcement.
 */
async function recipientIdsFor(
  scope: AnnouncementScope,
  scopeId: string | null,
  senderId: string,
  audiences: readonly AudienceKey[],
): Promise<string[]> {
  const roles = rolesForAudiences(audiences);

  const recipients = await prisma.user.findMany({
    where: {
      ...scopeFilter(scope, scopeId),
      id: { not: senderId },
      status: { not: "suspended" },
      ...(roles ? { role: { in: roles } } : {}),
    },
    select: { id: true },
  });

  return recipients.map((recipient) => recipient.id);
}

export async function createAnnouncement(
  sender: AuthenticatedUser,
  input: CreateAnnouncementInput,
): Promise<CreateAnnouncementResult> {
  // Throws if the role may not send, or if the account lacks the geography its
  // scope depends on.
  const { scope, scopeId } = await resolveSenderScope(sender);

  const recipientIds = await recipientIdsFor(scope, scopeId, sender.id, input.audiences);

  const announcement = await prisma.$transaction(async (tx) => {
    const created = await tx.announcement.create({
      data: {
        senderId: sender.id,
        title: input.title,
        body: input.body,
        scope,
        scopeId,
        // A real Postgres text[]. No JSON.stringify.
        audience: input.audiences,
      },
      select: ANNOUNCEMENT_SELECT,
    });

    for (let start = 0; start < recipientIds.length; start += RECIPIENT_CHUNK) {
      await tx.announcementRecipient.createMany({
        data: recipientIds
          .slice(start, start + RECIPIENT_CHUNK)
          .map((userId) => ({ announcementId: created.id, userId })),
        skipDuplicates: true,
      });
    }

    return created;
  });

  // Push and inbox delivery. notifyUsers never throws, so a delivery problem
  // cannot lose an announcement that is already committed.
  //
  // The old route selected every recipient's fcm_token under a comment about
  // offline push and then never sent anything, so announcements only ever
  // reached whoever happened to hold an open WebSocket.
  await notifyUsers(recipientIds, {
    title: announcement.title,
    body: preview(announcement.body),
    data: { type: "new_announcement", announcementId: announcement.id, scope },
  });

  // INTEGRATION: whoever owns the WebSocket server should broadcast
  // { type: "new_announcement", payload: { id, title, senderName, scope } } to
  // `recipientIds` here, so connected clients update without a refetch. Do not
  // put the announcement body in a log line while wiring it.
  logger.info("announcement sent", {
    announcementId: announcement.id,
    senderId: sender.id,
    scope,
    audiences: input.audiences,
    recipientCount: recipientIds.length,
  });

  return {
    announcement: {
      id: announcement.id,
      title: announcement.title,
      body: announcement.body,
      scope: announcement.scope,
      scopeId: announcement.scopeId,
      audience: announcement.audience,
      createdAt: announcement.createdAt,
    },
    recipientCount: recipientIds.length,
  };
}

// ─── Received ───────────────────────────────────────────────────────────────

export interface ListOptions {
  limit: number;
  offset: number;
}

/**
 * The caller's inbox: unread announcements plus anything read in the last day.
 *
 * The old query INNER JOINed the sender, so an announcement whose sender had
 * since been deleted vanished from every recipient's inbox. `sender` is nullable
 * in the schema and is treated as nullable here.
 */
export async function listReceived(
  userId: string,
  options: ListOptions & { unreadOnly: boolean },
) {
  const cutoff = new Date(Date.now() - RECENT_WINDOW_MS);

  const [rows, unreadCount] = await Promise.all([
    prisma.announcementRecipient.findMany({
      where: {
        userId,
        ...(options.unreadOnly ? { isRead: false } : {}),
        OR: [{ isRead: false }, { readAt: { gt: cutoff } }],
      },
      orderBy: { announcement: { createdAt: "desc" } },
      take: options.limit,
      skip: options.offset,
      select: {
        isRead: true,
        readAt: true,
        announcement: {
          select: { ...ANNOUNCEMENT_SELECT, sender: { select: SENDER_SELECT } },
        },
      },
    }),
    prisma.announcementRecipient.count({ where: { userId, isRead: false } }),
  ]);

  const announcements = rows.map((row) => ({
    ...row.announcement,
    isRead: row.isRead,
    readAt: row.readAt,
  }));

  return { announcements, unreadCount };
}

export function countUnread(userId: string): Promise<number> {
  return prisma.announcementRecipient.count({ where: { userId, isRead: false } });
}

/**
 * Marks one announcement read for the caller.
 *
 * Keyed on (announcementId, userId), so an id the caller was not sent is a 404
 * rather than a silent success. The old handler ran an unconditional UPDATE and
 * always returned `{ ok: true }`, which told a caller nothing about whether the
 * announcement existed or was theirs.
 */
export async function markRead(userId: string, announcementId: string): Promise<void> {
  const recipient = await prisma.announcementRecipient.findUnique({
    where: { announcementId_userId: { announcementId, userId } },
    select: { id: true, isRead: true },
  });
  if (!recipient) throw notFound("Announcement not found");
  if (recipient.isRead) return;

  await prisma.announcementRecipient.update({
    where: { id: recipient.id },
    data: { isRead: true, readAt: new Date() },
  });
}

export async function markAllRead(userId: string): Promise<number> {
  const updated = await prisma.announcementRecipient.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });
  return updated.count;
}

// ─── Sent ───────────────────────────────────────────────────────────────────

/**
 * Announcements the caller sent, with delivery and read counts.
 *
 * No role check: the filter is `senderId = caller`, which is what actually makes
 * this safe. The old handler gated on membership of the leader set and then
 * queried by sender id anyway, so the gate only produced a confusing 403 for a
 * demoted leader looking at their own history.
 */
export async function listSent(userId: string, options: ListOptions) {
  const announcements = await prisma.announcement.findMany({
    where: { senderId: userId },
    orderBy: { createdAt: "desc" },
    take: options.limit,
    skip: options.offset,
    select: { ...ANNOUNCEMENT_SELECT, _count: { select: { recipients: true } } },
  });

  if (announcements.length === 0) return { announcements: [] };

  const readGroups = await prisma.announcementRecipient.groupBy({
    by: ["announcementId"],
    where: { announcementId: { in: announcements.map((row) => row.id) }, isRead: true },
    _count: { _all: true },
  });
  const readCounts = new Map(readGroups.map((group) => [group.announcementId, group._count._all]));

  return {
    announcements: announcements.map(({ _count, ...announcement }) => ({
      ...announcement,
      recipientCount: _count.recipients,
      readCount: readCounts.get(announcement.id) ?? 0,
    })),
  };
}

/** Edits an announcement the caller sent. Ownership is part of the lookup. */
export async function editAnnouncement(
  userId: string,
  announcementId: string,
  input: EditAnnouncementInput,
) {
  const existing = await prisma.announcement.findFirst({
    where: { id: announcementId, senderId: userId },
    select: { id: true },
  });
  if (!existing) throw notFound("Announcement not found");

  return prisma.announcement.update({
    where: { id: existing.id },
    data: {
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.body === undefined ? {} : { body: input.body }),
    },
    select: ANNOUNCEMENT_SELECT,
  });
}
