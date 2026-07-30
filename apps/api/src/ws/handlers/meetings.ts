import { describeError, logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { bothInMeeting, isMeetingModerator, meetingAuthority, type MeetingAuthority } from "../authz";
import { broadcastToMeeting } from "../fanout";
import { defineHandler, sendError, type MessageHandlers, type WsContext } from "../protocol";
import { broadcast } from "../registry";
import {
  meetingChatSchema,
  meetingScopedSchema,
  meetingTargetSchema,
  meetingWebrtcIceSchema,
  meetingWebrtcSdpSchema,
  raiseHandSchema,
  toggleScreenShareSchema,
  transferHostSchema,
} from "../schemas";

/**
 * Conference meeting signalling.
 *
 * Not one handler in the old version checked that the sender had anything to do
 * with the meeting they named. Anyone holding a valid token could mute a
 * stranger, end someone else's meeting, read the participant list by watching who
 * echoed back, or inject chat into a call they were never in. Every handler below
 * now resolves the caller's authority first:
 *
 *   - host only:        end_meeting, transfer_host, approve/reject_join_request
 *   - host or co-host:  mute_participant
 *   - participant:      everything else
 */

/** Resolves the meeting and fails closed. Null means an error was already sent. */
async function authority(ctx: WsContext, meetingId: string): Promise<MeetingAuthority | null> {
  const resolved = await meetingAuthority(meetingId, ctx.user.id);
  if (!resolved) {
    sendError(ctx.socket, "Meeting not found");
    return null;
  }
  return resolved;
}

async function requireParticipant(
  ctx: WsContext,
  meetingId: string,
): Promise<MeetingAuthority | null> {
  const resolved = await authority(ctx, meetingId);
  if (!resolved) return null;
  if (!resolved.isParticipant) {
    sendError(ctx.socket, "Not a participant of this meeting");
    return null;
  }
  return resolved;
}

/**
 * Host only.
 *
 * Co-hosts previously shared these powers. If that should be restored, swap this
 * for `requireModerator`, which is the check `mute_participant` uses.
 */
async function requireHost(ctx: WsContext, meetingId: string): Promise<MeetingAuthority | null> {
  const resolved = await authority(ctx, meetingId);
  if (!resolved) return null;
  if (!resolved.isHost) {
    sendError(ctx.socket, "Only the meeting host can do that");
    return null;
  }
  return resolved;
}

async function requireModerator(
  ctx: WsContext,
  meetingId: string,
): Promise<MeetingAuthority | null> {
  const resolved = await authority(ctx, meetingId);
  if (!resolved) return null;
  if (!isMeetingModerator(resolved)) {
    sendError(ctx.socket, "Only the host or a co-host can do that");
    return null;
  }
  return resolved;
}

export const meetingHandlers: MessageHandlers = {
  meeting_joined: defineHandler(meetingScopedSchema, async (ctx, payload) => {
    if (!(await requireParticipant(ctx, payload.meeting_id))) return;

    await broadcastToMeeting(
      payload.meeting_id,
      {
        type: "meeting_participant_joined",
        payload: {
          meeting_id: payload.meeting_id,
          user_id: ctx.user.id,
          full_name: ctx.user.fullName,
        },
      },
      { excludeUserId: ctx.user.id },
    );
  }),

  leave_meeting: defineHandler(meetingScopedSchema, async (ctx, payload) => {
    if (!(await requireParticipant(ctx, payload.meeting_id))) return;

    await prisma.meetingParticipant.update({
      where: { meetingId_userId: { meetingId: payload.meeting_id, userId: ctx.user.id } },
      data: { leftAt: new Date() },
    });

    await broadcastToMeeting(payload.meeting_id, {
      type: "meeting_participant_left",
      payload: {
        meeting_id: payload.meeting_id,
        user_id: ctx.user.id,
        full_name: ctx.user.fullName,
      },
    });
  }),

  end_meeting: defineHandler(meetingScopedSchema, async (ctx, payload) => {
    if (!(await requireHost(ctx, payload.meeting_id))) return;

    await prisma.$transaction([
      prisma.meeting.update({
        where: { id: payload.meeting_id },
        data: { status: "ended", endedAt: new Date() },
      }),
      prisma.meetingParticipant.updateMany({
        where: { meetingId: payload.meeting_id, leftAt: null },
        data: { leftAt: new Date() },
      }),
    ]);

    // Everyone who was ever in the room hears about it, including people who had
    // already left, which is what the old query did by omitting the left filter.
    await broadcastToMeeting(
      payload.meeting_id,
      { type: "meeting_ended", payload: { meeting_id: payload.meeting_id, ended_by: ctx.user.id } },
      { includeLeft: true },
    );
  }),

  approve_join_request: defineHandler(meetingTargetSchema, async (ctx, payload) => {
    const resolved = await requireHost(ctx, payload.meeting_id);
    if (!resolved) return;
    if (resolved.status === "ended") {
      sendError(ctx.socket, "This meeting has ended");
      return;
    }

    // A request must exist. Without this the handler would be a way for a host
    // to add arbitrary accounts to a meeting nobody asked to join.
    const request = await prisma.meetingJoinRequest.findUnique({
      where: { meetingId_userId: { meetingId: payload.meeting_id, userId: payload.target_user_id } },
      select: { id: true },
    });
    if (!request) {
      sendError(ctx.socket, "That user has not asked to join");
      return;
    }

    await prisma.$transaction([
      prisma.meetingJoinRequest.update({
        where: { id: request.id },
        data: { status: "approved", resolvedAt: new Date() },
      }),
      prisma.meetingParticipant.upsert({
        where: {
          meetingId_userId: { meetingId: payload.meeting_id, userId: payload.target_user_id },
        },
        create: { meetingId: payload.meeting_id, userId: payload.target_user_id, role: "attendee" },
        update: { leftAt: null, joinedAt: new Date() },
      }),
    ]);

    broadcast(payload.target_user_id, {
      type: "join_request_approved",
      payload: { meeting_id: payload.meeting_id },
    });
  }),

  reject_join_request: defineHandler(meetingTargetSchema, async (ctx, payload) => {
    if (!(await requireHost(ctx, payload.meeting_id))) return;

    const request = await prisma.meetingJoinRequest.findUnique({
      where: { meetingId_userId: { meetingId: payload.meeting_id, userId: payload.target_user_id } },
      select: { id: true },
    });
    if (!request) {
      sendError(ctx.socket, "That user has not asked to join");
      return;
    }

    await prisma.meetingJoinRequest.update({
      where: { id: request.id },
      data: { status: "rejected", resolvedAt: new Date() },
    });

    broadcast(payload.target_user_id, {
      type: "join_request_rejected",
      payload: { meeting_id: payload.meeting_id },
    });
  }),

  mute_participant: defineHandler(meetingTargetSchema, async (ctx, payload) => {
    if (!(await requireModerator(ctx, payload.meeting_id))) return;

    const target = await prisma.meetingParticipant.findUnique({
      where: { meetingId_userId: { meetingId: payload.meeting_id, userId: payload.target_user_id } },
      select: { leftAt: true },
    });
    if (!target || target.leftAt !== null) {
      sendError(ctx.socket, "That user is not in this meeting");
      return;
    }

    await prisma.meetingParticipant.update({
      where: { meetingId_userId: { meetingId: payload.meeting_id, userId: payload.target_user_id } },
      data: { isMuted: true },
    });

    await broadcastToMeeting(payload.meeting_id, {
      type: "participant_muted",
      payload: {
        meeting_id: payload.meeting_id,
        user_id: payload.target_user_id,
        by: ctx.user.id,
      },
    });
  }),

  toggle_screen_share: defineHandler(toggleScreenShareSchema, async (ctx, payload) => {
    if (!(await requireParticipant(ctx, payload.meeting_id))) return;

    await broadcastToMeeting(payload.meeting_id, {
      type: "participant_screen_share",
      payload: {
        meeting_id: payload.meeting_id,
        user_id: ctx.user.id,
        sharing: payload.sharing,
      },
    });
  }),

  raise_hand: defineHandler(raiseHandSchema, async (ctx, payload) => {
    if (!(await requireParticipant(ctx, payload.meeting_id))) return;

    await prisma.meetingParticipant.update({
      where: { meetingId_userId: { meetingId: payload.meeting_id, userId: ctx.user.id } },
      data: { handRaised: payload.raised },
    });

    await broadcastToMeeting(payload.meeting_id, {
      type: "hand_raised",
      payload: {
        meeting_id: payload.meeting_id,
        user_id: ctx.user.id,
        full_name: ctx.user.fullName,
        raised: payload.raised,
      },
    });
  }),

  meeting_chat: defineHandler(meetingChatSchema, async (ctx, payload) => {
    if (!(await requireParticipant(ctx, payload.meeting_id))) return;

    // In-meeting chat is transient by design: it is relayed, never stored.
    await broadcastToMeeting(payload.meeting_id, {
      type: "meeting_chat_message",
      payload: {
        meeting_id: payload.meeting_id,
        from_user_id: ctx.user.id,
        from_name: ctx.user.fullName,
        message: payload.message,
        sent_at: new Date().toISOString(),
      },
    });
  }),

  transfer_host: defineHandler(transferHostSchema, async (ctx, payload) => {
    if (!(await requireHost(ctx, payload.meeting_id))) return;
    if (payload.new_host_id === ctx.user.id) {
      sendError(ctx.socket, "You are already the host");
      return;
    }

    // The old handler transferred the meeting to any user id at all, including
    // someone who had never joined.
    const successor = await prisma.meetingParticipant.findUnique({
      where: { meetingId_userId: { meetingId: payload.meeting_id, userId: payload.new_host_id } },
      select: { leftAt: true },
    });
    if (!successor || successor.leftAt !== null) {
      sendError(ctx.socket, "That user is not in this meeting");
      return;
    }

    await prisma.$transaction([
      prisma.meeting.update({
        where: { id: payload.meeting_id },
        data: { hostId: payload.new_host_id },
      }),
      prisma.meetingParticipant.update({
        where: { meetingId_userId: { meetingId: payload.meeting_id, userId: payload.new_host_id } },
        data: { role: "host" },
      }),
      prisma.meetingParticipant.update({
        where: { meetingId_userId: { meetingId: payload.meeting_id, userId: ctx.user.id } },
        data: { role: "co_host" },
      }),
    ]);

    await broadcastToMeeting(payload.meeting_id, {
      type: "host_transferred",
      payload: {
        meeting_id: payload.meeting_id,
        new_host_id: payload.new_host_id,
        previous_host_id: ctx.user.id,
      },
    });
  }),

  meeting_webrtc_offer: defineHandler(meetingWebrtcSdpSchema, async (ctx, payload) => {
    await relayMeetingSdp(ctx, "meeting_webrtc_offer", payload);
  }),

  meeting_webrtc_answer: defineHandler(meetingWebrtcSdpSchema, async (ctx, payload) => {
    await relayMeetingSdp(ctx, "meeting_webrtc_answer", payload);
  }),

  meeting_webrtc_ice: defineHandler(meetingWebrtcIceSchema, async (ctx, payload) => {
    if (!(await bothInMeeting(payload.meeting_id, ctx.user.id, payload.target_user_id))) {
      sendError(ctx.socket, "Not a participant of this meeting");
      return;
    }
    broadcast(payload.target_user_id, {
      type: "meeting_webrtc_ice",
      payload: {
        from_user_id: ctx.user.id,
        meeting_id: payload.meeting_id,
        candidate: payload.candidate,
      },
    });
  }),
};

async function relayMeetingSdp(
  ctx: WsContext,
  type: "meeting_webrtc_offer" | "meeting_webrtc_answer",
  payload: { meeting_id: string; target_user_id: string; sdp: { type: string; sdp: string } },
): Promise<void> {
  if (!(await bothInMeeting(payload.meeting_id, ctx.user.id, payload.target_user_id))) {
    sendError(ctx.socket, "Not a participant of this meeting");
    return;
  }
  broadcast(payload.target_user_id, {
    type,
    payload: {
      from_user_id: ctx.user.id,
      meeting_id: payload.meeting_id,
      sdp: payload.sdp,
    },
  });
}

/**
 * Hands active meetings to their longest-standing co-host when the host's last
 * socket goes away, so a host losing signal does not strand the room.
 */
export async function promoteCoHostOnDisconnect(userId: string): Promise<void> {
  try {
    const hosted = await prisma.meeting.findMany({
      where: { hostId: userId, status: "active" },
      select: { id: true },
    });

    for (const meeting of hosted) {
      const successor = await prisma.meetingParticipant.findFirst({
        where: { meetingId: meeting.id, role: "co_host", leftAt: null, userId: { not: userId } },
        orderBy: { joinedAt: "asc" },
        select: { userId: true },
      });
      if (!successor) continue;

      await prisma.$transaction([
        prisma.meeting.update({ where: { id: meeting.id }, data: { hostId: successor.userId } }),
        prisma.meetingParticipant.update({
          where: { meetingId_userId: { meetingId: meeting.id, userId: successor.userId } },
          data: { role: "host" },
        }),
      ]);

      await broadcastToMeeting(meeting.id, {
        type: "host_transferred",
        payload: {
          meeting_id: meeting.id,
          new_host_id: successor.userId,
          previous_host_id: userId,
          reason: "host_disconnected",
        },
      });
    }
  } catch (error) {
    logger.error("co-host promotion failed", { userId, ...describeError(error) });
  }
}
