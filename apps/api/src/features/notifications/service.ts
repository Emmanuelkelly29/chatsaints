import type { Prisma } from "../../generated/prisma/client";
import { describeError, logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { sendPush } from "./push";

/**
 * The notification fan-out used by every other feature.
 *
 * `notifyUsers` is the single entry point: it writes one Notification row per
 * recipient and then attempts push delivery to whichever of them have a device
 * token. Other features should never touch the Notification model or Firebase
 * directly.
 *
 * The old backend had two disconnected halves. services/notificationService.js
 * sent push and never persisted anything, so a notification received while the
 * app was closed left no trace to read later. routes/notifications.js read a
 * notifications table that nothing in the codebase ever wrote to, so the
 * endpoint always returned an empty list. Announcements even selected fcm_token
 * for "offline push" and then dropped the result on the floor.
 */

/** JSON-safe values allowed in a notification payload. */
export type NotificationDataValue = string | number | boolean | null;
export type NotificationData = Record<string, NotificationDataValue>;

export interface NotifyPayload {
  title: string;
  body: string;
  /** Structured payload for the client to route on, e.g. `{ type, statusId }`. */
  data?: NotificationData;
}

export interface NotifyResult {
  /** Deliverable recipients, after dropping unknown and suspended accounts. */
  recipients: number;
  /** Notification rows written. */
  stored: number;
  /** Push messages FCM accepted. */
  pushed: number;
}

/** Keeps a single INSERT well under Postgres' bind-parameter ceiling. */
const STORE_CHUNK = 500;

/** Body text is previewed rather than stored in full. Clients fetch the source. */
export const NOTIFICATION_BODY_LIMIT = 240;

/** Shortens free text for a notification body without splitting mid-word ugly. */
export function preview(text: string, limit = NOTIFICATION_BODY_LIMIT): string {
  const collapsed = text.trim().replace(/\s+/g, " ");
  return collapsed.length <= limit ? collapsed : `${collapsed.slice(0, limit - 1).trimEnd()}…`;
}

/** FCM data values must be strings. Nulls become empty strings. */
function toPushData(data: NotificationData | undefined): Record<string, string> | undefined {
  if (!data) return undefined;
  const entries = Object.entries(data).map(
    ([key, value]) => [key, value === null ? "" : String(value)] as const,
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/**
 * Notifies many users at once.
 *
 * Deliberately never throws. A notification is a side effect of some other
 * action, and that action must not fail because a device token expired. Failures
 * are logged and reflected in the returned counts.
 *
 * Titles and payload keys are safe to log. Bodies are not, so they never are.
 */
export async function notifyUsers(
  userIds: readonly string[],
  payload: NotifyPayload,
): Promise<NotifyResult> {
  const result: NotifyResult = { recipients: 0, stored: 0, pushed: 0 };

  const unique = [...new Set(userIds)].filter((id) => id.length > 0);
  if (unique.length === 0) return result;

  try {
    // Resolving ids first does two jobs: it drops accounts that no longer exist
    // (a bulk insert would otherwise fail wholesale on one bad id) and it keeps
    // suspended accounts from being notified.
    const recipients = await prisma.user.findMany({
      where: { id: { in: unique }, status: { not: "suspended" } },
      select: { id: true, fcmToken: true },
    });

    result.recipients = recipients.length;
    if (recipients.length === 0) return result;

    const data: Prisma.InputJsonValue | undefined = payload.data;

    for (let start = 0; start < recipients.length; start += STORE_CHUNK) {
      const chunk = recipients.slice(start, start + STORE_CHUNK);
      const created = await prisma.notification.createMany({
        data: chunk.map((recipient) => ({
          userId: recipient.id,
          title: payload.title,
          body: payload.body,
          ...(data === undefined ? {} : { data }),
        })),
      });
      result.stored += created.count;
    }

    // One entry per distinct token. Two accounts sharing a device would
    // otherwise get the same push twice.
    const tokenOwners = new Map<string, string>();
    for (const recipient of recipients) {
      if (recipient.fcmToken) tokenOwners.set(recipient.fcmToken, recipient.id);
    }

    if (tokenOwners.size > 0) {
      const pushData = toPushData(payload.data);
      const delivery = await sendPush([...tokenOwners.keys()], {
        title: payload.title,
        body: payload.body,
        ...(pushData ? { data: pushData } : {}),
      });
      result.pushed = delivery.sent;

      if (delivery.deadTokens.length > 0) {
        // Stop paying for deliveries that can never arrive.
        await prisma.user.updateMany({
          where: { fcmToken: { in: delivery.deadTokens } },
          data: { fcmToken: null },
        });
      }
    }
  } catch (error) {
    logger.error("notification fan-out failed", {
      requested: unique.length,
      stored: result.stored,
      ...describeError(error),
    });
  }

  return result;
}

/** Convenience wrapper for the single-recipient case. */
export function notifyUser(userId: string, payload: NotifyPayload): Promise<NotifyResult> {
  return notifyUsers([userId], payload);
}

// ─── Read paths for the router ──────────────────────────────────────────────
// Every query here is keyed on the calling user's id. There is no endpoint that
// can reach another account's notifications.

export interface ListNotificationsOptions {
  limit: number;
  offset: number;
  unreadOnly: boolean;
}

export async function listNotifications(userId: string, options: ListNotificationsOptions) {
  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId, ...(options.unreadOnly ? { isRead: false } : {}) },
      orderBy: { createdAt: "desc" },
      take: options.limit,
      skip: options.offset,
      select: { id: true, title: true, body: true, data: true, isRead: true, createdAt: true },
    }),
    prisma.notification.count({ where: { userId, isRead: false } }),
  ]);

  return { notifications, unreadCount };
}

export function countUnread(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, isRead: false } });
}

/**
 * Marks one notification read. Scoped to the caller, so a notification id
 * belonging to somebody else is indistinguishable from one that does not exist.
 */
export async function markRead(userId: string, notificationId: string): Promise<boolean> {
  const updated = await prisma.notification.updateMany({
    where: { id: notificationId, userId },
    data: { isRead: true },
  });
  return updated.count > 0;
}

export async function markAllRead(userId: string): Promise<number> {
  const updated = await prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true },
  });
  return updated.count;
}
