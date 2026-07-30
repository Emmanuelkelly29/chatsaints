import { isHiddenRole, tierOf } from "../../domain/roles";
import type { LeadershipRole, MessageType, UserStatus } from "../../generated/prisma/enums";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { badRequest, forbidden, notFound } from "../../middleware/errorHandler";
import type { CreateConversationInput, MessageListQuery } from "./schemas";

/**
 * Conversation reads and writes.
 *
 * Every query here goes through Prisma. The old controller hand-wrote SQL with
 * correlated subqueries per row and, for writes, looped INSERTs outside a
 * transaction, so a failure part-way through left a conversation with some of
 * its members.
 */

// ─── Access control ─────────────────────────────────────────────────────────
// Ported from the old utils/accessControl.js. It lives here rather than in a
// shared module because the visibility rules only govern who may open a chat.

/** The fields any visibility decision needs. `AuthenticatedUser` satisfies it. */
interface ChatParty {
  id: string;
  role: LeadershipRole;
  status: UserStatus;
  missionId: string | null;
  missionPresidentMissionId: string | null;
  missionaryModeActive: boolean;
}

const CHAT_PARTY_SELECT = {
  id: true,
  fullName: true,
  profilePhotoUrl: true,
  role: true,
  status: true,
  isApproved: true,
  missionId: true,
  missionPresidentMissionId: true,
  missionaryModeActive: true,
} as const;

/** A missionary account is confined to its own mission. */
function isMissionaryLocked(user: ChatParty): boolean {
  return user.missionaryModeActive || user.status === "missionary" || user.role === "missionary";
}

/**
 * Same mission, where "neither has one" does not count.
 *
 * The old comparisons were bare `viewer.mission_id === target.mission_id`, so
 * two accounts with no mission at all compared equal and passed the check.
 */
function sameMission(left: string | null, right: string | null): boolean {
  return left !== null && left === right;
}

function isMissionLeader(role: LeadershipRole): boolean {
  return role === "mission_president" || role === "mission_president_wife";
}

function canViewProfile(viewer: ChatParty, target: ChatParty): boolean {
  if (viewer.id === target.id) return true;

  // IT support is not a universal bypass anywhere else in this codebase, but
  // support does need to be able to see an account to act on a report.
  if (viewer.role === "it_support") return true;

  if (isMissionaryLocked(viewer)) {
    if (target.role === "missionary") return sameMission(viewer.missionId, target.missionId);
    if (isMissionLeader(target.role)) {
      return sameMission(viewer.missionId, target.missionPresidentMissionId);
    }
    return false;
  }

  if (isMissionLeader(viewer.role)) {
    if (isMissionLeader(target.role)) return true;
    if (target.role === "missionary") {
      return sameMission(viewer.missionPresidentMissionId, target.missionId);
    }
  }

  // Senior leaders are visible only from their own tier upwards.
  if (isHiddenRole(target.role)) return tierOf(viewer.role) >= tierOf(target.role);

  return true;
}

/** One-to-one chat needs at least one side able to see the other. */
function canChatDirectly(viewer: ChatParty, target: ChatParty): boolean {
  if (isMissionaryLocked(viewer)) {
    if (target.role === "missionary") return sameMission(viewer.missionId, target.missionId);
    if (isMissionLeader(target.role)) {
      return sameMission(viewer.missionId, target.missionPresidentMissionId);
    }
    return false;
  }
  return canViewProfile(viewer, target) || canViewProfile(target, viewer);
}

/**
 * Vetting for someone being placed into a group.
 *
 * A group invitation is not a one-to-one chat, so it does not require a contact
 * connection. It must still respect the two rules that exist to protect people
 * rather than to reduce noise: a missionary belongs only to groups for their own
 * mission, and a senior leader cannot be pulled into a group by someone who is
 * not allowed to see them in the first place.
 */
function assertMayAddToGroup(
  actor: ChatParty,
  invitee: ChatParty & { isApproved: boolean },
  conversation: { missionId: string | null },
): void {
  if (!invitee.isApproved) {
    throw forbidden("One of those members cannot be added to a group yet.");
  }
  if (isMissionaryLocked(invitee) && !sameMission(conversation.missionId, invitee.missionId)) {
    throw forbidden("A missionary can only be added to a group for their own mission.");
  }
  if (isHiddenRole(invitee.role) && tierOf(actor.role) < tierOf(invitee.role)) {
    throw forbidden("You cannot add that member to a group.");
  }
}

// ─── Shared helpers ─────────────────────────────────────────────────────────

interface Membership {
  isAdmin: boolean;
}

/**
 * Confirms the caller is a *current* member. `leftAt` matters: a member who left
 * keeps their row, and several old queries checked only `user_id`, so leaving a
 * group did not actually revoke access.
 */
async function requireMembership(conversationId: string, userId: string): Promise<Membership> {
  const membership = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
    select: { isAdmin: true, leftAt: true },
  });
  if (!membership || membership.leftAt !== null) {
    throw forbidden("Not a member of this conversation");
  }
  return { isAdmin: membership.isAdmin };
}

/**
 * Contact connections are stored once per pair with `user_low_id < user_high_id`
 * enforced by a CHECK constraint. Order with a plain string comparison, which
 * matches Postgres byte ordering for lowercase hex UUIDs; the old code used
 * `localeCompare`, whose collation rules are not the same ordering.
 */
function orderPair(first: string, second: string): [string, string] {
  return first < second ? [first, second] : [second, first];
}

// ─── Listing ────────────────────────────────────────────────────────────────

export interface ConversationSummary {
  id: string;
  name: string;
  isGroup: boolean;
  photoUrl: string | null;
  role: LeadershipRole | null;
  otherUserId: string | null;
  isAdmin: boolean;
  memberCount: number;
  unreadCount: number;
  createdAt: Date;
  lastMessage: { content: string | null; type: MessageType; createdAt: Date } | null;
}

export async function listConversations(userId: string): Promise<ConversationSummary[]> {
  const memberships = await prisma.conversationMember.findMany({
    where: { userId, leftAt: null },
    select: {
      isAdmin: true,
      conversation: {
        select: {
          id: true,
          name: true,
          isGroup: true,
          photoUrl: true,
          createdAt: true,
          // Prisma resolves a limited to-many include with a window function,
          // so this stays one query rather than one per conversation.
          messages: {
            where: { isDeleted: false },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { content: true, type: true, createdAt: true },
          },
        },
      },
    },
  });

  if (memberships.length === 0) return [];

  const ids = memberships.map((row) => row.conversation.id);
  const directIds = memberships
    .filter((row) => !row.conversation.isGroup)
    .map((row) => row.conversation.id);

  // Three aggregate queries for the whole list. The old SQL ran six correlated
  // subqueries for every row returned.
  const [memberCounts, unreadCounts, others] = await Promise.all([
    prisma.conversationMember.groupBy({
      by: ["conversationId"],
      where: { conversationId: { in: ids }, leftAt: null },
      _count: { _all: true },
    }),
    prisma.message.groupBy({
      by: ["conversationId"],
      where: {
        conversationId: { in: ids },
        isDeleted: false,
        // A message you sent is not unread, and a message you have a read
        // receipt for is not unread either.
        senderId: { not: userId },
        reads: { none: { userId } },
      },
      _count: { _all: true },
    }),
    directIds.length > 0
      ? prisma.conversationMember.findMany({
          where: { conversationId: { in: directIds }, leftAt: null, userId: { not: userId } },
          select: {
            conversationId: true,
            user: { select: { id: true, fullName: true, profilePhotoUrl: true, role: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const memberCountByConversation = new Map(
    memberCounts.map((row) => [row.conversationId, row._count._all]),
  );
  const unreadByConversation = new Map(
    unreadCounts.map((row) => [row.conversationId, row._count._all]),
  );
  const otherByConversation = new Map(others.map((row) => [row.conversationId, row.user]));

  const summaries = memberships.map((row): ConversationSummary => {
    const conversation = row.conversation;
    const other = conversation.isGroup ? undefined : otherByConversation.get(conversation.id);
    const lastMessage = conversation.messages[0] ?? null;

    return {
      id: conversation.id,
      // A direct conversation carries no name of its own; it is titled by the
      // other participant.
      name: conversation.isGroup
        ? (conversation.name ?? "Group")
        : (other?.fullName ?? conversation.name ?? "Chat"),
      isGroup: conversation.isGroup,
      photoUrl: conversation.isGroup
        ? conversation.photoUrl
        : (other?.profilePhotoUrl ?? conversation.photoUrl),
      role: conversation.isGroup ? null : (other?.role ?? null),
      otherUserId: other?.id ?? null,
      isAdmin: row.isAdmin,
      memberCount: memberCountByConversation.get(conversation.id) ?? 0,
      unreadCount: unreadByConversation.get(conversation.id) ?? 0,
      createdAt: conversation.createdAt,
      lastMessage,
    };
  });

  // Most recent activity first, conversations with no messages last.
  return summaries.sort((left, right) => {
    const leftAt = left.lastMessage?.createdAt ?? null;
    const rightAt = right.lastMessage?.createdAt ?? null;
    if (leftAt && rightAt) return rightAt.getTime() - leftAt.getTime();
    if (leftAt) return -1;
    if (rightAt) return 1;
    return right.createdAt.getTime() - left.createdAt.getTime();
  });
}

// ─── One-to-one conversations ───────────────────────────────────────────────

export interface DirectConversationView {
  id: string;
  name: string;
  isGroup: false;
  photoUrl: string | null;
  role: LeadershipRole;
  otherUserId: string;
  memberCount: number;
}

/**
 * Either the conversation, or the reason a contact request stands in the way.
 *
 * The blocked case is a result rather than a thrown error because the client
 * needs to know *which* request state it is in to render the right call to
 * action, and `HttpError` carries only a message.
 */
export type StartDirectResult =
  | { kind: "conversation"; created: boolean; conversation: DirectConversationView }
  | {
      kind: "blocked";
      message: string;
      requiresRequest: boolean;
      requestStatus: "none" | "outgoing_pending" | "incoming_pending";
      requestId: string | null;
    };

/**
 * Finds or creates the one-to-one conversation between the caller and `targetUserId`.
 *
 * This is the only path that may create a direct conversation. `POST /` routes
 * its non-group case through here too: previously it built one from
 * `member_ids` directly, which skipped the visibility rules and the contact
 * connection requirement entirely and so defeated the whole contact-request
 * gate.
 */
export async function startDirectConversation(
  user: ChatParty,
  targetUserId: string,
): Promise<StartDirectResult> {
  if (targetUserId === user.id) throw badRequest("Cannot chat with yourself");

  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: CHAT_PARTY_SELECT,
  });
  if (!target) throw notFound("User not found");

  const existing = await prisma.conversation.findFirst({
    where: {
      isGroup: false,
      AND: [
        { members: { some: { userId: user.id, leftAt: null } } },
        { members: { some: { userId: targetUserId, leftAt: null } } },
      ],
    },
    select: { id: true },
  });

  if (existing) {
    return { kind: "conversation", created: false, conversation: directView(existing.id, target) };
  }

  if (!target.isApproved) throw forbidden("This user cannot receive chats yet");
  if (!canChatDirectly(user, target)) throw forbidden("You cannot chat with this user");

  const [userLowId, userHighId] = orderPair(user.id, targetUserId);
  const connection = await prisma.contactConnection.findUnique({
    where: { userLowId_userHighId: { userLowId, userHighId } },
    select: { id: true },
  });

  if (!connection) {
    const pending = await prisma.contactRequest.findFirst({
      where: {
        status: "pending",
        OR: [
          { senderId: user.id, recipientId: targetUserId },
          { senderId: targetUserId, recipientId: user.id },
        ],
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, senderId: true },
    });

    if (pending) {
      const outgoing = pending.senderId === user.id;
      return {
        kind: "blocked",
        message: outgoing
          ? "Connection request already pending"
          : "This user already requested to connect. Accept the request first.",
        requiresRequest: false,
        requestStatus: outgoing ? "outgoing_pending" : "incoming_pending",
        requestId: pending.id,
      };
    }

    return {
      kind: "blocked",
      message: "Connection request required before starting a chat",
      requiresRequest: true,
      requestStatus: "none",
      requestId: null,
    };
  }

  // Both member rows are written with the conversation, so there is no window
  // in which a conversation exists without its participants.
  //
  // Nothing in the schema can express "at most one direct conversation per
  // pair", so two simultaneous first messages can still produce two rows. The
  // reader above then settles on one of them.
  const created = await prisma.conversation.create({
    data: {
      isGroup: false,
      createdById: user.id,
      members: {
        create: [
          { userId: user.id, isAdmin: true },
          { userId: targetUserId, isAdmin: false },
        ],
      },
    },
    select: { id: true },
  });

  logger.info("direct conversation created", { conversationId: created.id });
  return { kind: "conversation", created: true, conversation: directView(created.id, target) };
}

function directView(
  conversationId: string,
  other: { id: string; fullName: string; profilePhotoUrl: string | null; role: LeadershipRole },
): DirectConversationView {
  return {
    id: conversationId,
    name: other.fullName,
    isGroup: false,
    photoUrl: other.profilePhotoUrl,
    role: other.role,
    otherUserId: other.id,
    memberCount: 2,
  };
}

// ─── Creation ───────────────────────────────────────────────────────────────

export interface GroupCreated {
  id: string;
  name: string | null;
  description: string | null;
  photoUrl: string | null;
  isGroup: true;
  missionId: string | null;
  createdAt: Date;
  isAdmin: true;
  memberCount: number;
}

export type CreateConversationResult = StartDirectResult | { kind: "group"; group: GroupCreated };

export async function createConversation(
  user: ChatParty,
  input: CreateConversationInput,
): Promise<CreateConversationResult> {
  const inviteeIds = input.member_ids.filter((id) => id !== user.id);
  if (inviteeIds.length === 0) throw badRequest("At least one other member is required");

  if (!input.is_group) {
    const [targetUserId] = inviteeIds;
    if (!targetUserId) throw badRequest("At least one other member is required");
    return startDirectConversation(user, targetUserId);
  }

  return { kind: "group", group: await createGroupConversation(user, input, inviteeIds) };
}

async function createGroupConversation(
  user: ChatParty,
  input: CreateConversationInput,
  inviteeIds: string[],
): Promise<GroupCreated> {
  const missionId = input.mission_id ?? null;

  if (isMissionaryLocked(user) && !missionId) {
    throw forbidden("Missionaries can only create mission-internal groups");
  }

  const invitees = await prisma.user.findMany({
    where: { id: { in: inviteeIds } },
    select: CHAT_PARTY_SELECT,
  });
  if (invitees.length !== inviteeIds.length) {
    throw badRequest("One or more of those members do not exist");
  }
  for (const invitee of invitees) {
    assertMayAddToGroup(user, invitee, { missionId });
  }

  const conversation = await prisma.conversation.create({
    data: {
      name: input.name ?? null,
      description: input.description ?? null,
      photoUrl: input.photo_url ?? null,
      isGroup: true,
      missionId,
      createdById: user.id,
      members: {
        create: [
          { userId: user.id, isAdmin: true },
          ...inviteeIds.map((userId) => ({ userId, isAdmin: false })),
        ],
      },
    },
    select: {
      id: true,
      name: true,
      description: true,
      photoUrl: true,
      missionId: true,
      createdAt: true,
    },
  });

  logger.info("group created", { conversationId: conversation.id, memberCount: inviteeIds.length + 1 });

  // INTEGRATION: notify each invitee that they were added to a group once the
  // notifications feature exposes a service.
  return {
    ...conversation,
    isGroup: true,
    isAdmin: true,
    memberCount: inviteeIds.length + 1,
  };
}

// ─── Messages within a conversation ─────────────────────────────────────────

export interface ConversationMessage {
  id: string;
  type: MessageType;
  content: string | null;
  mediaUrl: string | null;
  replyToId: string | null;
  isDeleted: boolean;
  createdAt: Date;
  senderId: string | null;
  sender: { id: string; fullName: string; profilePhotoUrl: string | null } | null;
}

export async function listConversationMessages(
  conversationId: string,
  userId: string,
  query: MessageListQuery,
): Promise<ConversationMessage[]> {
  await requireMembership(conversationId, userId);

  const messages = await prisma.message.findMany({
    where: {
      conversationId,
      isDeleted: false,
      ...(query.before ? { createdAt: { lt: query.before } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: query.limit,
    select: {
      id: true,
      type: true,
      content: true,
      mediaUrl: true,
      replyToId: true,
      isDeleted: true,
      createdAt: true,
      senderId: true,
      // Nullable: the author's account may have been deleted, which nulls the
      // sender rather than deleting everyone else's copy of the conversation.
      sender: { select: { id: true, fullName: true, profilePhotoUrl: true } },
    },
  });

  return messages.reverse();
}

// ─── Pinning ────────────────────────────────────────────────────────────────

const MAX_PINNED = 3;

/**
 * Pinning requires membership. It previously did not, so any id could be
 * pinned, and `GET /pinned` then returned the name and photo of a conversation
 * the caller had nothing to do with.
 */
export async function pinConversation(
  conversationId: string,
  userId: string,
): Promise<{ message: string }> {
  await requireMembership(conversationId, userId);

  const existing = await prisma.pinnedConversation.findUnique({
    where: { userId_conversationId: { userId, conversationId } },
    select: { id: true },
  });
  if (existing) return { message: "Chat pinned" };

  const pinned = await prisma.pinnedConversation.count({ where: { userId } });
  if (pinned >= MAX_PINNED) throw badRequest(`Maximum ${MAX_PINNED} pinned chats allowed`);

  await prisma.pinnedConversation.create({ data: { userId, conversationId } });
  return { message: "Chat pinned" };
}

export async function unpinConversation(
  conversationId: string,
  userId: string,
): Promise<{ message: string }> {
  await prisma.pinnedConversation.deleteMany({ where: { userId, conversationId } });
  return { message: "Unpinned" };
}

export interface PinnedConversationView {
  id: string;
  name: string | null;
  isGroup: boolean;
  photoUrl: string | null;
  pinnedAt: Date;
}

export async function listPinnedConversations(userId: string): Promise<PinnedConversationView[]> {
  const pinned = await prisma.pinnedConversation.findMany({
    where: {
      userId,
      // A conversation the caller has since left should not keep showing up.
      conversation: { members: { some: { userId, leftAt: null } } },
    },
    orderBy: { pinnedAt: "desc" },
    select: {
      pinnedAt: true,
      conversation: { select: { id: true, name: true, isGroup: true, photoUrl: true } },
    },
  });

  return pinned.map((row) => ({ ...row.conversation, pinnedAt: row.pinnedAt }));
}
