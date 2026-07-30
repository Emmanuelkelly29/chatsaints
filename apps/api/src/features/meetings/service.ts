import { randomInt } from "node:crypto";

import bcrypt from "bcryptjs";

import type { MeetingRole, MeetingStatus } from "../../generated/prisma/enums";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { badRequest, forbidden, HttpError, notFound } from "../../middleware/errorHandler";
import type { CreateMeetingInput, PromoteInput } from "./schemas";

/**
 * Meetings: a hosted room with a code, an optional key, an optional approval
 * queue, and roles.
 *
 * The join key is stored only as a bcrypt hash, in `Meeting.joinKeyHash` (column
 * `join_key`). Nothing in this module selects that column into a response. The
 * old code relied on `{ ...meeting, join_key: undefined }` and JSON.stringify
 * dropping the key, which put one property name between the hash and the wire;
 * responses here are built field by field instead.
 */

const BCRYPT_ROUNDS = 12;

/** Everything safe to return about a meeting. Never includes the key hash. */
const MEETING_SELECT = {
  id: true,
  hostId: true,
  title: true,
  description: true,
  meetingCode: true,
  requiresApproval: true,
  allowLinkJoin: true,
  maxParticipants: true,
  status: true,
  startedAt: true,
  endedAt: true,
  createdAt: true,
  host: { select: { id: true, fullName: true, role: true, profilePhotoUrl: true } },
} as const;

const PARTICIPANT_SELECT = {
  userId: true,
  role: true,
  joinedAt: true,
  isMuted: true,
  handRaised: true,
  user: { select: { id: true, fullName: true, profilePhotoUrl: true, role: true } },
} as const;

export type PublicMeeting = {
  id: string;
  hostId: string | null;
  title: string;
  description: string | null;
  meetingCode: string;
  requiresApproval: boolean;
  allowLinkJoin: boolean;
  maxParticipants: number;
  status: MeetingStatus;
  startedAt: Date | null;
  endedAt: Date | null;
  createdAt: Date;
  host: { id: string; fullName: string; role: string; profilePhotoUrl: string | null } | null;
};

/** A meeting that has ended is gone, not merely forbidden. */
function gone(): HttpError {
  return new HttpError(410, "This meeting has ended.");
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "code" in error && error.code === "P2002"
  );
}

/**
 * A nine-digit code, displayed in groups of three.
 *
 * The old generator was `Math.floor(100000000 + Math.random() * 900000000)`:
 * predictable, and it could never produce a leading zero, so a ninth of the
 * space was unreachable. `randomInt` over the full range with zero padding uses
 * all 10^9 codes and does not leak its own state.
 */
function generateMeetingCode(): string {
  const digits = randomInt(0, 1_000_000_000).toString().padStart(9, "0");
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)}`;
}

async function loadMeeting(id: string): Promise<PublicMeeting> {
  const meeting = await prisma.meeting.findUnique({ where: { id }, select: MEETING_SELECT });
  if (!meeting) throw notFound("Meeting not found");
  return meeting;
}

async function activeParticipants(meetingId: string) {
  return prisma.meetingParticipant.findMany({
    where: { meetingId, leftAt: null },
    orderBy: { joinedAt: "asc" },
    select: PARTICIPANT_SELECT,
  });
}

/** The caller's role in a meeting, or null if they are not currently in it. */
async function roleOf(meetingId: string, userId: string): Promise<MeetingRole | null> {
  const participant = await prisma.meetingParticipant.findUnique({
    where: { meetingId_userId: { meetingId, userId } },
    select: { role: true, leftAt: true },
  });
  if (!participant || participant.leftAt) return null;
  return participant.role;
}

/** Host or co-host: the two roles that can moderate. */
async function requireModerator(meeting: PublicMeeting, userId: string): Promise<void> {
  if (meeting.hostId === userId) return;
  if ((await roleOf(meeting.id, userId)) === "co_host") return;
  throw forbidden("Only the host or a co-host can do that.");
}

/** Synchronous: the host is a column on the meeting, not a participant lookup. */
function requireHost(meeting: PublicMeeting, userId: string): void {
  if (meeting.hostId !== userId) throw forbidden("Only the host can do that.");
}

/**
 * Host or current participant. Anything that exposes the roster goes through
 * here.
 */
async function requireInMeeting(meeting: PublicMeeting, userId: string): Promise<void> {
  if (meeting.hostId === userId) return;
  if ((await roleOf(meeting.id, userId)) !== null) return;
  throw forbidden("You are not a participant in this meeting.");
}

// ─── Create ─────────────────────────────────────────────────────────────────

export async function createMeeting(
  userId: string,
  input: CreateMeetingInput,
): Promise<PublicMeeting> {
  const joinKeyHash = input.join_key ? await bcrypt.hash(input.join_key, BCRYPT_ROUNDS) : null;

  const coHostIds = [...new Set(input.co_host_ids)].filter((id) => id !== userId);

  // Note the roster consequence of pre-adding co-hosts, which the old code had
  // too: a designated co-host counts as present from the moment the meeting is
  // created, because there is no "invited" state to put them in. Preserved
  // deliberately, since designating co-hosts up front is the point of the field.
  const participants = [
    { userId, role: "host" as const },
    ...coHostIds.map((id) => ({ userId: id, role: "co_host" as const })),
  ];

  // The only unique constraint that can fail here is `meeting_code`, since the
  // co-host ids are deduplicated above. The old code generated one code, checked
  // it with a SELECT, and on collision generated a second code that it then used
  // without checking at all.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const meeting = await prisma.meeting.create({
        data: {
          hostId: userId,
          title: input.title,
          description: input.description ?? null,
          meetingCode: generateMeetingCode(),
          joinKeyHash,
          requiresApproval: input.requires_approval,
          allowLinkJoin: input.allow_link_join,
          maxParticipants: input.max_participants,
          // `startedAt` stays null until somebody joins. The old insert set it to
          // NOW() while writing status 'waiting', so every meeting claimed to
          // have started before it had.
          status: "waiting",
          participants: { create: participants },
        },
        select: MEETING_SELECT,
      });

      logger.info("meeting created", { meetingId: meeting.id, hostId: userId });
      return meeting;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }

  throw new HttpError(503, "Could not allocate a meeting code. Please try again.");
}

// ─── Read ───────────────────────────────────────────────────────────────────

export interface MeetingPreview {
  id: string;
  title: string;
  description: string | null;
  meetingCode: string;
  requiresApproval: boolean;
  allowLinkJoin: boolean;
  status: MeetingStatus;
  maxParticipants: number;
  hasKey: boolean;
  hostName: string | null;
  participantCount: number;
}

/**
 * What someone holding a code can see before joining: enough to decide whether
 * to knock, and no roster.
 */
export async function previewByCode(code: string): Promise<MeetingPreview> {
  const meeting = await prisma.meeting.findUnique({
    where: { meetingCode: code },
    select: {
      id: true,
      title: true,
      description: true,
      meetingCode: true,
      requiresApproval: true,
      allowLinkJoin: true,
      status: true,
      maxParticipants: true,
      joinKeyHash: true,
      host: { select: { fullName: true } },
    },
  });
  if (!meeting) throw notFound("Meeting not found");
  if (meeting.status === "ended") throw gone();

  const participantCount = await prisma.meetingParticipant.count({
    where: { meetingId: meeting.id, leftAt: null },
  });

  return {
    id: meeting.id,
    title: meeting.title,
    description: meeting.description,
    meetingCode: meeting.meetingCode,
    requiresApproval: meeting.requiresApproval,
    allowLinkJoin: meeting.allowLinkJoin,
    status: meeting.status,
    maxParticipants: meeting.maxParticipants,
    // Whether a key is needed, never the hash itself.
    hasKey: meeting.joinKeyHash !== null,
    hostName: meeting.host?.fullName ?? null,
    participantCount,
  };
}

export async function meetingDetail(userId: string, meetingId: string) {
  const meeting = await loadMeeting(meetingId);
  await requireInMeeting(meeting, userId);

  const isHost = meeting.hostId === userId;
  const [participants, pendingRequests] = await Promise.all([
    activeParticipants(meeting.id),
    isHost
      ? prisma.meetingJoinRequest.findMany({
          where: { meetingId: meeting.id, status: "pending" },
          orderBy: { requestedAt: "asc" },
          select: {
            userId: true,
            requestedAt: true,
            user: { select: { id: true, fullName: true, profilePhotoUrl: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  return { ...meeting, participants, pendingRequests };
}

export interface MyMeeting {
  id: string;
  title: string;
  meetingCode: string;
  status: MeetingStatus;
  requiresApproval: boolean;
  allowLinkJoin: boolean;
  createdAt: Date;
  hostName: string | null;
  amHost: boolean;
  myRole: MeetingRole;
  iLeft: boolean;
  participantCount: number;
}

/** Every meeting the caller is in, or was in, that has not ended. */
export async function myActiveMeetings(userId: string): Promise<MyMeeting[]> {
  const rows = await prisma.meetingParticipant.findMany({
    where: { userId, meeting: { status: { not: "ended" } } },
    orderBy: { meeting: { createdAt: "desc" } },
    select: {
      role: true,
      leftAt: true,
      meeting: {
        select: {
          id: true,
          title: true,
          meetingCode: true,
          status: true,
          requiresApproval: true,
          allowLinkJoin: true,
          createdAt: true,
          hostId: true,
          host: { select: { fullName: true } },
        },
      },
    },
  });
  if (rows.length === 0) return [];

  // One grouped count rather than a correlated subquery per row, which is what
  // the old SQL did.
  const counts = await prisma.meetingParticipant.groupBy({
    by: ["meetingId"],
    where: { meetingId: { in: rows.map((row) => row.meeting.id) }, leftAt: null },
    _count: { _all: true },
  });
  const countByMeeting = new Map(counts.map((row) => [row.meetingId, row._count._all]));

  return rows.map((row) => ({
    id: row.meeting.id,
    title: row.meeting.title,
    meetingCode: row.meeting.meetingCode,
    status: row.meeting.status,
    requiresApproval: row.meeting.requiresApproval,
    allowLinkJoin: row.meeting.allowLinkJoin,
    createdAt: row.meeting.createdAt,
    hostName: row.meeting.host?.fullName ?? null,
    amHost: row.meeting.hostId === userId,
    myRole: row.role,
    iLeft: row.leftAt !== null,
    participantCount: countByMeeting.get(row.meeting.id) ?? 0,
  }));
}

/**
 * The active roster.
 *
 * The old route ran the roster query straight off the path id with no host or
 * participant check, so any approved account could enumerate who was in any
 * meeting, by id, including their names and photos.
 */
export async function meetingParticipants(userId: string, meetingId: string) {
  const meeting = await loadMeeting(meetingId);
  await requireInMeeting(meeting, userId);
  return activeParticipants(meeting.id);
}

// ─── Join ───────────────────────────────────────────────────────────────────

export type JoinResult =
  | { status: "joined"; meetingId: string; participants: Awaited<ReturnType<typeof activeParticipants>> }
  | { status: "pending_approval"; meetingId: string }
  | { status: "key_required"; meetingId: string };

export async function joinMeeting(
  userId: string,
  meetingId: string,
  joinKey: string | undefined,
): Promise<JoinResult> {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: {
      id: true,
      hostId: true,
      status: true,
      allowLinkJoin: true,
      requiresApproval: true,
      maxParticipants: true,
      joinKeyHash: true,
    },
  });
  if (!meeting) throw notFound("Meeting not found");
  if (meeting.status === "ended") throw gone();

  const isHost = meeting.hostId === userId;

  if (!meeting.allowLinkJoin && !isHost) {
    throw forbidden("Link joining is disabled for this meeting.");
  }

  const existing = await prisma.meetingParticipant.findUnique({
    where: { meetingId_userId: { meetingId: meeting.id, userId } },
    select: { id: true, leftAt: true },
  });

  // Someone already in the meeting is already in the meeting. The old order
  // checked capacity first, so a participant whose connection dropped could not
  // rejoin a full meeting they were still counted in.
  if (existing && !existing.leftAt) {
    return {
      status: "joined",
      meetingId: meeting.id,
      participants: await activeParticipants(meeting.id),
    };
  }

  if (meeting.joinKeyHash) {
    if (!joinKey) return { status: "key_required", meetingId: meeting.id };
    if (!(await bcrypt.compare(joinKey, meeting.joinKeyHash))) {
      throw forbidden("Incorrect meeting key.");
    }
  }

  const activeCount = await prisma.meetingParticipant.count({
    where: { meetingId: meeting.id, leftAt: null },
  });
  if (activeCount >= meeting.maxParticipants) {
    throw forbidden("This meeting is at full capacity.");
  }

  if (meeting.requiresApproval && !isHost) {
    const request = await prisma.meetingJoinRequest.findUnique({
      where: { meetingId_userId: { meetingId: meeting.id, userId } },
      select: { status: true },
    });

    if (request?.status === "rejected") {
      throw forbidden("Your request to join this meeting was declined.");
    }

    if (request?.status !== "approved") {
      await prisma.meetingJoinRequest.upsert({
        where: { meetingId_userId: { meetingId: meeting.id, userId } },
        create: { meetingId: meeting.id, userId, status: "pending" },
        update: { status: "pending", requestedAt: new Date(), resolvedAt: null },
        select: { id: true },
      });

      // INTEGRATION: notify the host and co-hosts that somebody is waiting to be
      // let in. Owned by the notifications feature.
      return { status: "pending_approval", meetingId: meeting.id };
    }
  }

  const participants = await admitParticipant(meeting.id, userId, "attendee");
  return { status: "joined", meetingId: meeting.id, participants };
}

/**
 * Adds or readmits a participant and moves the meeting out of `waiting`.
 *
 * `joinedAt` is reset on readmission so the roster orders by current arrival.
 */
async function admitParticipant(
  meetingId: string,
  userId: string,
  role: MeetingRole,
): Promise<Awaited<ReturnType<typeof activeParticipants>>> {
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.meetingParticipant.upsert({
      where: { meetingId_userId: { meetingId, userId } },
      create: { meetingId, userId, role },
      update: { leftAt: null, joinedAt: now },
      select: { id: true },
    });

    await tx.meeting.updateMany({
      where: { id: meetingId, status: "waiting" },
      data: { status: "active", startedAt: now },
    });
  });

  return activeParticipants(meetingId);
}

// ─── Approval queue ─────────────────────────────────────────────────────────

/**
 * Approves a pending request.
 *
 * The old handler updated the join request by (meeting, user) without checking
 * that a request existed, then inserted the participant regardless. A host could
 * therefore POST /:id/approve/:userId for any user id and pull that person into
 * the meeting without them ever asking to join.
 */
export async function approveJoinRequest(
  actorId: string,
  meetingId: string,
  targetId: string,
): Promise<{ status: "approved" }> {
  const meeting = await loadMeeting(meetingId);
  if (meeting.status === "ended") throw gone();
  await requireModerator(meeting, actorId);

  const updated = await prisma.meetingJoinRequest.updateMany({
    where: { meetingId: meeting.id, userId: targetId, status: "pending" },
    data: { status: "approved", resolvedAt: new Date() },
  });
  if (updated.count === 0) throw notFound("No pending join request for that user.");

  await admitParticipant(meeting.id, targetId, "attendee");

  // INTEGRATION: tell the applicant they were let in.
  return { status: "approved" };
}

export async function rejectJoinRequest(
  actorId: string,
  meetingId: string,
  targetId: string,
): Promise<{ status: "rejected" }> {
  const meeting = await loadMeeting(meetingId);
  await requireModerator(meeting, actorId);

  const updated = await prisma.meetingJoinRequest.updateMany({
    where: { meetingId: meeting.id, userId: targetId, status: "pending" },
    data: { status: "rejected", resolvedAt: new Date() },
  });
  if (updated.count === 0) throw notFound("No pending join request for that user.");

  return { status: "rejected" };
}

// ─── Membership and roles ───────────────────────────────────────────────────

export async function leaveMeeting(
  userId: string,
  meetingId: string,
): Promise<{ status: "left" }> {
  const meeting = await loadMeeting(meetingId);
  if (meeting.status === "ended") throw gone();

  const updated = await prisma.meetingParticipant.updateMany({
    where: { meetingId: meeting.id, userId, leftAt: null },
    data: { leftAt: new Date() },
  });
  if (updated.count === 0) throw notFound("You are not in this meeting.");

  return { status: "left" };
}

export async function addCoHost(
  actorId: string,
  meetingId: string,
  targetId: string,
): Promise<{ status: "co_host_added"; userId: string }> {
  const meeting = await loadMeeting(meetingId);
  if (meeting.status === "ended") throw gone();
  requireHost(meeting, actorId);

  if (targetId === actorId) throw badRequest("You are already the host.");

  const target = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true } });
  if (!target) throw notFound("User not found");

  await prisma.meetingParticipant.upsert({
    where: { meetingId_userId: { meetingId: meeting.id, userId: targetId } },
    create: { meetingId: meeting.id, userId: targetId, role: "co_host" },
    update: { role: "co_host" },
    select: { id: true },
  });

  return { status: "co_host_added", userId: targetId };
}

/**
 * Changes a participant's role.
 *
 * The old handler ran an UPDATE that matched nothing when the target was not in
 * the meeting, and still answered `{ status: 'promoted' }`.
 */
export async function promoteParticipant(
  actorId: string,
  meetingId: string,
  targetId: string,
  input: PromoteInput,
): Promise<{ status: "promoted"; userId: string; role: MeetingRole }> {
  const meeting = await loadMeeting(meetingId);
  if (meeting.status === "ended") throw gone();
  requireHost(meeting, actorId);

  if (targetId === meeting.hostId) {
    throw badRequest("The host's role is changed by transferring the host role.");
  }

  const updated = await prisma.meetingParticipant.updateMany({
    where: { meetingId: meeting.id, userId: targetId, leftAt: null },
    data: { role: input.role },
  });
  if (updated.count === 0) throw notFound("That user is not in the meeting.");

  return { status: "promoted", userId: targetId, role: input.role };
}

export async function setParticipantMuted(
  actorId: string,
  meetingId: string,
  targetId: string,
  muted: boolean,
): Promise<{ status: "muted" | "unmuted"; userId: string }> {
  const meeting = await loadMeeting(meetingId);
  if (meeting.status === "ended") throw gone();
  await requireModerator(meeting, actorId);

  const updated = await prisma.meetingParticipant.updateMany({
    where: { meetingId: meeting.id, userId: targetId, leftAt: null },
    data: { isMuted: muted },
  });
  if (updated.count === 0) throw notFound("That user is not in the meeting.");

  return { status: muted ? "muted" : "unmuted", userId: targetId };
}

export async function endMeeting(
  actorId: string,
  meetingId: string,
): Promise<{ status: "ended" }> {
  const meeting = await loadMeeting(meetingId);
  if (meeting.status === "ended") throw gone();
  await requireModerator(meeting, actorId);

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.meeting.update({
      where: { id: meeting.id },
      data: { status: "ended", endedAt: now },
      select: { id: true },
    });
    await tx.meetingParticipant.updateMany({
      where: { meetingId: meeting.id, leftAt: null },
      data: { leftAt: now },
    });
  });

  logger.info("meeting ended", { meetingId: meeting.id, endedBy: actorId });
  return { status: "ended" };
}

export async function transferHost(
  actorId: string,
  meetingId: string,
  targetId: string,
): Promise<{ status: "transferred"; newHostId: string }> {
  const meeting = await loadMeeting(meetingId);
  if (meeting.status === "ended") throw gone();
  requireHost(meeting, actorId);

  if (targetId === actorId) throw badRequest("You are already the host.");

  if ((await roleOf(meeting.id, targetId)) === null) {
    throw notFound("That user is not in the meeting.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.meeting.update({
      where: { id: meeting.id },
      data: { hostId: targetId },
      select: { id: true },
    });
    await tx.meetingParticipant.updateMany({
      where: { meetingId: meeting.id, userId: targetId },
      data: { role: "host" },
    });
    // The outgoing host keeps moderator powers rather than being demoted to
    // attendee in their own meeting.
    await tx.meetingParticipant.updateMany({
      where: { meetingId: meeting.id, userId: actorId },
      data: { role: "co_host" },
    });
  });

  logger.info("meeting host transferred", { meetingId: meeting.id, from: actorId, to: targetId });
  return { status: "transferred", newHostId: targetId };
}
