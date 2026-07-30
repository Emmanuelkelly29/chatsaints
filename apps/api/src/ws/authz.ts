import { tierOf } from "../domain/roles";
import type { LeadershipRole, MeetingRole, MeetingStatus } from "../generated/prisma/enums";
import { prisma } from "../lib/prisma";
import type { WsUser } from "./protocol";

/**
 * Every authorization question the realtime handlers ask.
 *
 * The old server checked membership for exactly one message type
 * (`send_message`). Everything else took an id straight off the wire and acted
 * on it, which made most of the socket surface reachable for any conversation or
 * meeting in the system. These helpers are the checks those handlers were
 * missing; they are deliberately in one file so the guarantees are auditable in
 * one read.
 */

/** Current membership of a conversation. `leftAt` counts: leaving revokes access. */
export async function isConversationMember(
  conversationId: string,
  userId: string,
): Promise<boolean> {
  const membership = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
    select: { leftAt: true },
  });
  return membership !== null && membership.leftAt === null;
}

export async function conversationMissionId(conversationId: string): Promise<string | null> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { missionId: true },
  });
  return conversation?.missionId ?? null;
}

export interface MessageOwner {
  conversationId: string;
  senderId: string | null;
}

/** Resolves a message to its conversation, so a read receipt can be authorized. */
export async function messageOwner(messageId: string): Promise<MessageOwner | null> {
  return prisma.message.findUnique({
    where: { id: messageId },
    select: { conversationId: true, senderId: true },
  });
}

// ─── Calls ───────────────────────────────────────────────────────────────────

export interface CallRecord {
  id: string;
  conversationId: string | null;
  type: "voice" | "video";
  status: "initiated" | "answered" | "declined" | "missed" | "ended";
  startedAt: Date | null;
}

export function findCall(callId: string): Promise<CallRecord | null> {
  return prisma.call.findUnique({
    where: { id: callId },
    select: { id: true, conversationId: true, type: true, status: true, startedAt: true },
  });
}

/**
 * Whether both users are participants of the same call.
 *
 * WebRTC signalling used to relay to any `target_user_id` at all, so the socket
 * doubled as a way to push offers and ICE candidates at strangers. Participant
 * rows are written for every conversation member when the call is created, so
 * this is the natural relationship to require.
 */
export async function bothInCall(callId: string, a: string, b: string): Promise<boolean> {
  if (a === b) return false;
  const participants = await prisma.callParticipant.count({
    where: { callId, userId: { in: [a, b] } },
  });
  return participants === 2;
}

// ─── Meetings ────────────────────────────────────────────────────────────────

export interface MeetingAuthority {
  meetingId: string;
  status: MeetingStatus;
  /** True only for the account named in `Meeting.hostId`. */
  isHost: boolean;
  /** True for a participant row that has not left. */
  isParticipant: boolean;
  /** The caller's participant role, or null when they are not in the meeting. */
  role: MeetingRole | null;
}

/** Resolves what the caller is allowed to do in a meeting. Null if no meeting. */
export async function meetingAuthority(
  meetingId: string,
  userId: string,
): Promise<MeetingAuthority | null> {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: { id: true, hostId: true, status: true },
  });
  if (!meeting) return null;

  const participant = await prisma.meetingParticipant.findUnique({
    where: { meetingId_userId: { meetingId, userId } },
    select: { role: true, leftAt: true },
  });
  const active = participant !== null && participant.leftAt === null;

  return {
    meetingId: meeting.id,
    status: meeting.status,
    isHost: meeting.hostId === userId,
    isParticipant: active,
    role: active && participant ? participant.role : null,
  };
}

/** Host or co-host. Matches the moderator powers the REST meeting routes grant. */
export function isMeetingModerator(authority: MeetingAuthority): boolean {
  return authority.isHost || authority.role === "co_host";
}

/** Both users are active participants of the same meeting. */
export async function bothInMeeting(meetingId: string, a: string, b: string): Promise<boolean> {
  if (a === b) return false;
  const participants = await prisma.meetingParticipant.count({
    where: { meetingId, leftAt: null, userId: { in: [a, b] } },
  });
  return participants === 2;
}

// ─── Domain rules ────────────────────────────────────────────────────────────

const MISSIONARY_CALLABLE_ROLES: ReadonlySet<LeadershipRole> = new Set<LeadershipRole>([
  "missionary",
  "mission_president",
  "mission_president_wife",
]);

/**
 * Whether `caller` may place a call to `target`.
 *
 * Ported from the old config/hierarchy.js `canCall`, but scored against
 * domain/roles ROLE_TIER rather than that file's private ROLE_LEVEL table, which
 * disagreed with it on mission presidents and omitted `ysa_couple_adviser`
 * entirely (so `undefined >= undefined` decided the comparison).
 */
export function canCall(caller: LeadershipRole, target: LeadershipRole): boolean {
  if (caller === "it_support") return true;
  if (caller === "missionary") return MISSIONARY_CALLABLE_ROLES.has(target);
  return tierOf(caller) >= tierOf(target);
}

/** A missionary account, however it came to be one, is scoped to its mission. */
export function isMissionaryLocked(
  user: Pick<WsUser, "role" | "status" | "missionaryModeActive">,
): boolean {
  return user.missionaryModeActive || user.status === "missionary" || user.role === "missionary";
}
