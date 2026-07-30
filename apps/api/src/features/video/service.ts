import { randomUUID } from "node:crypto";

import { isLiveKitConfigured } from "../../config/env";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import type { AuthenticatedUser } from "../../middleware/auth";
import { forbidden, notFound } from "../../middleware/errorHandler";
import { issueLiveKitToken, liveKitUnavailable } from "./livekit";
import type { CreateRoomInput } from "./schemas";

/**
 * Group video rooms, backed by LiveKit.
 *
 * This module owns room records and membership. Media itself never touches this
 * server: clients connect straight to LiveKit with the token minted here.
 */

/**
 * Whether an account is restricted to mission-scoped features.
 *
 * A local copy of the old `isMissionaryLocked` predicate, kept private to this
 * feature rather than promoted to a shared module, because it is the only
 * remaining caller in this port. The three conditions are unchanged.
 */
function isMissionaryLocked(user: AuthenticatedUser): boolean {
  return (
    user.missionaryModeActive || user.status === "missionary" || user.role === "missionary"
  );
}

/**
 * Confirms current membership and returns the conversation's mission scope.
 *
 * Reported as "not found" rather than "forbidden" so the endpoint cannot be used
 * to discover which conversation ids exist.
 */
async function requireMembership(
  userId: string,
  conversationId: string,
): Promise<{ missionId: string | null }> {
  const membership = await prisma.conversationMember.findFirst({
    where: { conversationId, userId, leftAt: null },
    select: { conversation: { select: { missionId: true } } },
  });
  if (!membership) throw notFound("Conversation not found");
  return membership.conversation;
}

export interface JoinedRoom {
  roomId: string;
  roomName: string;
  livekitUrl: string;
  token: string;
  expiresInSeconds: number;
  maxParticipants: number;
}

export async function createOrJoinRoom(
  user: AuthenticatedUser,
  input: CreateRoomInput,
): Promise<JoinedRoom> {
  // Checked before anything is written. Creating a room record and a participant
  // row and then discovering there is no way to connect leaves rubbish behind
  // and reports success for a call that cannot happen.
  if (!isLiveKitConfigured) throw liveKitUnavailable();

  const conversation = await requireMembership(user.id, input.conversation_id);

  if (isMissionaryLocked(user)) {
    if (!conversation.missionId || conversation.missionId !== user.missionId) {
      throw forbidden("Missionaries can only join mission-scoped video calls.");
    }
  }

  // Prefer the oldest active room so concurrent joiners converge on the same
  // one. Two simultaneous first-joiners can still each create a room; the loser
  // ends up with a room of one that closes as soon as they leave.
  const existing = await prisma.videoRoom.findFirst({
    where: { conversationId: input.conversation_id, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, roomName: true, maxParticipants: true },
  });

  const room =
    existing ??
    (await prisma.videoRoom.create({
      data: {
        conversationId: input.conversation_id,
        // Random rather than `room-${conversationId}-${Date.now()}`: a room name
        // derived from a conversation id is guessable, and room names are
        // reused as LiveKit identifiers.
        roomName: `conv-${randomUUID()}`,
        createdById: user.id,
        maxParticipants: input.max_participants,
        isActive: true,
      },
      select: { id: true, roomName: true, maxParticipants: true },
    }));

  if (!existing) {
    logger.info("video room created", { roomId: room.id, conversationId: input.conversation_id });
    // INTEGRATION: tell the other conversation members a call has started. The
    // notifications feature owns push delivery and the WebSocket server owns the
    // live event.
  }

  const activeCount = await prisma.videoRoomParticipant.count({
    where: { roomId: room.id, leftAt: null, userId: { not: user.id } },
  });
  if (activeCount + 1 > room.maxParticipants) {
    throw forbidden("This video call is full.");
  }

  await prisma.videoRoomParticipant.upsert({
    where: { roomId_userId: { roomId: room.id, userId: user.id } },
    create: { roomId: room.id, userId: user.id },
    update: { joinedAt: new Date(), leftAt: null },
    select: { id: true },
  });

  const credentials = issueLiveKitToken(room.roomName, user.id, user.fullName);

  return {
    roomId: room.id,
    roomName: room.roomName,
    livekitUrl: credentials.url,
    token: credentials.token,
    expiresInSeconds: credentials.expiresInSeconds,
    maxParticipants: room.maxParticipants,
  };
}

/**
 * Marks the caller as having left, and closes the room once it is empty.
 *
 * The old handler updated `video_room_participants` for the caller, then counted
 * the remaining participants and closed the room if none were left, without ever
 * checking that the caller was in the room. A non-participant's update matched
 * zero rows but the close still ran.
 */
export async function leaveRoom(userId: string, roomId: string): Promise<{ status: "left" }> {
  const participant = await prisma.videoRoomParticipant.findUnique({
    where: { roomId_userId: { roomId, userId } },
    select: { id: true },
  });
  if (!participant) throw notFound("Video room not found");

  await prisma.$transaction(async (tx) => {
    await tx.videoRoomParticipant.update({
      where: { id: participant.id },
      data: { leftAt: new Date() },
      select: { id: true },
    });

    const remaining = await tx.videoRoomParticipant.count({
      where: { roomId, leftAt: null },
    });

    if (remaining === 0) {
      await tx.videoRoom.updateMany({
        where: { id: roomId, isActive: true },
        data: { isActive: false, endedAt: new Date() },
      });
    }
  });

  return { status: "left" };
}

export type ActiveRoomResult =
  | { active: false }
  | {
      active: true;
      room: { id: string; roomName: string; createdAt: Date; participantCount: number };
    };

/**
 * Whether a conversation currently has a video call running.
 *
 * The old handler took a conversation id from the path and answered for anybody,
 * with no membership check, so any authenticated account could learn whether a
 * conversation it had no part in was in a call and how many people were on it.
 */
export async function activeRoom(
  userId: string,
  conversationId: string,
): Promise<ActiveRoomResult> {
  await requireMembership(userId, conversationId);

  const room = await prisma.videoRoom.findFirst({
    where: { conversationId, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, roomName: true, createdAt: true },
  });
  if (!room) return { active: false };

  const participantCount = await prisma.videoRoomParticipant.count({
    where: { roomId: room.id, leftAt: null },
  });

  return { active: true, room: { ...room, participantCount } };
}
