import type { CallStatus, CallType, LeadershipRole } from "../../generated/prisma/enums";
import { prisma } from "../../lib/prisma";
import { badRequest, conflict, forbidden, notFound } from "../../middleware/errorHandler";
import type { CallHistoryQuery, InitiateCallInput } from "./schemas";

/**
 * Call log and call lifecycle.
 *
 * The old table carried a three-way naming split: the migration created `type`
 * and `duration_secs`, while the WebSocket server and this router wrote
 * `call_type` and `duration_seconds`. Every insert failed twice over, once on
 * the unknown column and once on the omitted NOT NULL `type`. The schema now
 * settles on `type` and `durationSeconds`, and Prisma makes a repeat of that
 * drift a compile error.
 */

const OTHER_PARTY_SELECT = {
  id: true,
  fullName: true,
  profilePhotoUrl: true,
  role: true,
} as const;

export interface CallParty {
  id: string;
  fullName: string;
  profilePhotoUrl: string | null;
  role: LeadershipRole;
}

export interface CallHistoryEntry {
  id: string;
  type: CallType;
  status: CallStatus;
  isOutgoing: boolean;
  startedAt: Date | null;
  endedAt: Date | null;
  durationSeconds: number | null;
  createdAt: Date;
  otherUser: CallParty | null;
  participantCount: number;
}

/**
 * The caller's own call log.
 *
 * Scoping is by participation, so a call is only ever visible to someone who
 * was on it. The old SQL did the same thing through a self-join on
 * `call_participants`, but the LEFT JOIN to find the other party multiplied rows
 * per participant, so a group call consumed several of the caller's LIMIT slots
 * and then got deduplicated in JavaScript. Page sizes were therefore wrong for
 * anyone who had ever been in a group call.
 */
export async function callHistory(
  userId: string,
  { limit, offset }: CallHistoryQuery,
): Promise<{ calls: CallHistoryEntry[] }> {
  const rows = await prisma.call.findMany({
    where: { participants: { some: { userId } } },
    orderBy: { createdAt: "desc" },
    take: limit,
    skip: offset,
    select: {
      id: true,
      type: true,
      status: true,
      startedAt: true,
      endedAt: true,
      durationSeconds: true,
      createdAt: true,
      initiatedById: true,
      _count: { select: { participants: true } },
      participants: {
        where: { userId: { not: userId } },
        orderBy: { joinedAt: "asc" },
        take: 1,
        select: { user: { select: OTHER_PARTY_SELECT } },
      },
    },
  });

  return {
    calls: rows.map((row) => ({
      id: row.id,
      type: row.type,
      status: row.status,
      isOutgoing: row.initiatedById === userId,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      durationSeconds: row.durationSeconds,
      createdAt: row.createdAt,
      otherUser: row.participants[0]?.user ?? null,
      participantCount: row._count.participants,
    })),
  };
}

/**
 * Every participant of a group call must be a current member of the
 * conversation it belongs to.
 *
 * Non-membership is reported as "not found" so the endpoint cannot be used to
 * probe for conversation ids.
 */
async function assertConversationCall(
  userId: string,
  conversationId: string,
  targetIds: string[],
): Promise<void> {
  const members = await prisma.conversationMember.findMany({
    where: { conversationId, leftAt: null },
    select: { userId: true },
  });

  const memberIds = new Set(members.map((member) => member.userId));
  if (!memberIds.has(userId)) throw notFound("Conversation not found");

  if (targetIds.some((id) => !memberIds.has(id))) {
    throw badRequest("Every participant must be a current member of the conversation.");
  }
}

/**
 * A one-to-one call requires an existing relationship: an accepted contact
 * connection, or a conversation both people are currently in.
 *
 * The old endpoint inserted whatever user ids the body contained, so any
 * account could ring any other account by id, repeatedly, with a push
 * notification each time.
 */
async function assertDirectCall(userId: string, targetId: string): Promise<void> {
  const userLowId = userId < targetId ? userId : targetId;
  const userHighId = userId < targetId ? targetId : userId;

  const connection = await prisma.contactConnection.findUnique({
    where: { userLowId_userHighId: { userLowId, userHighId } },
    select: { id: true },
  });
  if (connection) return;

  const shared = await prisma.conversationMember.findFirst({
    where: {
      userId: targetId,
      leftAt: null,
      conversation: { members: { some: { userId, leftAt: null } } },
    },
    select: { id: true },
  });
  if (shared) return;

  throw forbidden("You can only call people you are already connected to.");
}

export interface InitiatedCall {
  id: string;
  type: CallType;
  status: CallStatus;
  conversationId: string | null;
  initiatedById: string | null;
  createdAt: Date;
  participants: CallParty[];
}

export async function initiateCall(
  userId: string,
  input: InitiateCallInput,
): Promise<{ call: InitiatedCall }> {
  const targetIds = [...new Set(input.participantIds)].filter((id) => id !== userId);
  if (targetIds.length === 0) {
    throw badRequest("A call needs at least one other participant.");
  }

  if (input.conversationId) {
    await assertConversationCall(userId, input.conversationId, targetIds);
  } else if (targetIds.length === 1 && targetIds[0]) {
    await assertDirectCall(userId, targetIds[0]);
  } else {
    throw badRequest("A group call requires a conversationId.");
  }

  // `joinedAt` comes from the column default. The old inserts omitted it and the
  // column had no default, so every participant row recorded a null join time.
  const call = await prisma.call.create({
    data: {
      type: input.type,
      status: "initiated",
      conversationId: input.conversationId ?? null,
      initiatedById: userId,
      participants: { create: [userId, ...targetIds].map((id) => ({ userId: id })) },
    },
    select: {
      id: true,
      type: true,
      status: true,
      conversationId: true,
      initiatedById: true,
      createdAt: true,
      participants: {
        orderBy: { joinedAt: "asc" },
        // Deliberately no fcm_token here. The old response embedded every
        // participant's push token, handing any caller the credential needed to
        // send notifications to all of them. Delivery is the server's job.
        select: { user: { select: OTHER_PARTY_SELECT } },
      },
    },
  });

  // INTEGRATION: ring the other participants. The notifications feature owns
  // push delivery and the WebSocket server owns the live `incoming_call` event;
  // both read the call by id, so nothing about the token belongs in this
  // response.

  return {
    call: {
      id: call.id,
      type: call.type,
      status: call.status,
      conversationId: call.conversationId,
      initiatedById: call.initiatedById,
      createdAt: call.createdAt,
      participants: call.participants.map((participant) => participant.user),
    },
  };
}

/** Statuses after which a call cannot change state again. */
const TERMINAL: ReadonlySet<CallStatus> = new Set<CallStatus>(["ended", "declined", "missed"]);

export interface UpdatedCall {
  id: string;
  type: CallType;
  status: CallStatus;
  startedAt: Date | null;
  endedAt: Date | null;
  durationSeconds: number | null;
}

/**
 * Advance a call's status.
 *
 * The old handler ran `UPDATE calls SET status = $1 WHERE id = $2` behind
 * `authenticate` alone, with no participant check at all, and returned the
 * whole row. Any authenticated account could end, decline or mis-mark any call
 * in the system by guessing or observing an id, and read its metadata back.
 *
 * The `where` clause here requires the caller to be a participant, and a call
 * they are not on is reported as not found.
 */
export async function updateCallStatus(
  userId: string,
  callId: string,
  status: CallStatus,
): Promise<{ call: UpdatedCall }> {
  const call = await prisma.call.findFirst({
    where: { id: callId, participants: { some: { userId } } },
    select: { id: true, status: true, startedAt: true },
  });
  if (!call) throw notFound("Call not found");

  if (TERMINAL.has(call.status)) {
    throw conflict("This call has already finished.");
  }

  const now = new Date();
  const finishing = TERMINAL.has(status);
  // Answering starts the clock. The old code never set `started_at`, so the
  // duration of every call was unknowable even when it was recorded.
  const startedAt = status === "answered" ? (call.startedAt ?? now) : call.startedAt;

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.call.update({
      where: { id: call.id },
      data: {
        status,
        ...(startedAt ? { startedAt } : {}),
        ...(finishing ? { endedAt: now } : {}),
        ...(status === "ended" && startedAt
          ? {
              durationSeconds: Math.max(
                0,
                Math.round((now.getTime() - startedAt.getTime()) / 1000),
              ),
            }
          : {}),
      },
      select: {
        id: true,
        type: true,
        status: true,
        startedAt: true,
        endedAt: true,
        durationSeconds: true,
      },
    });

    if (finishing) {
      await tx.callParticipant.updateMany({
        where: { callId: call.id, leftAt: null },
        data: { leftAt: now },
      });
    }

    return result;
  });

  return { call: updated };
}
