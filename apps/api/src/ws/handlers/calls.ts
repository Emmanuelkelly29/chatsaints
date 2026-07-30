import type { CallStatus, CallType } from "../../generated/prisma/enums";
import { prisma } from "../../lib/prisma";
import { bothInCall, canCall, findCall, isConversationMember } from "../authz";
import { broadcastToConversation } from "../fanout";
import { defineHandler, send, sendError, type MessageHandlers, type WsContext } from "../protocol";
import { broadcast, getOnlineUserIds } from "../registry";
import { callScopedSchema, initiateCallSchema, webrtcIceSchema, webrtcSdpSchema } from "../schemas";

/**
 * One-to-one and group call signalling.
 *
 * Three classes of bug are fixed here.
 *
 *   - The call row itself. The old INSERT named `call_type` and
 *     `duration_seconds` while the table had `type` and `duration_secs`, so every
 *     WebSocket-initiated call failed twice over: once on the unknown column and
 *     once on omitting the NOT NULL `type`. The Prisma model settles on `type`
 *     and `durationSeconds`.
 *   - Trusted conversation ids. `end_call` and `call_declined` validated only
 *     that `call_id` looked like a UUID and then passed the caller's own
 *     `conversation_id` into the routine that writes a "call ended" message row.
 *     Any authenticated user could therefore post messages into any conversation
 *     in the system. The conversation is now read off the call record and
 *     membership is verified before anything is written.
 *   - Unrestricted relay. Offers, answers and ICE candidates went to whatever
 *     `target_user_id` the sender named. Both ends must now be participants of
 *     the same call.
 */

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = String(Math.floor(total / 60)).padStart(2, "0");
  const remainder = String(total % 60).padStart(2, "0");
  return `${minutes}:${remainder}`;
}

interface CallEvent {
  conversationId: string;
  actorId: string;
  actorName: string;
  content: string;
}

/**
 * Writes the "Voice call ended" style line that the client renders inside the
 * thread.
 *
 * This is the server authoring a message row on a user's behalf, which is
 * unusual enough to be worth naming. It is kept because the mobile app relies on
 * those lines for call history in-thread, but it now refuses to write unless the
 * actor really is a current member of the conversation.
 */
async function logCallEvent(event: CallEvent): Promise<void> {
  if (!(await isConversationMember(event.conversationId, event.actorId))) return;

  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.message.create({
      data: {
        conversationId: event.conversationId,
        senderId: event.actorId,
        type: "text",
        content: event.content,
      },
      select: { id: true, createdAt: true },
    });
    await tx.conversation.update({
      where: { id: event.conversationId },
      data: { updatedAt: new Date() },
    });
    return created;
  });

  await broadcastToConversation(event.conversationId, {
    type: "new_message",
    payload: {
      id: message.id,
      conversation_id: event.conversationId,
      sender_id: event.actorId,
      sender_name: event.actorName,
      type: "text",
      content: event.content,
      media_url: null,
      created_at: message.createdAt.toISOString(),
      reply_to_message_id: null,
    },
  });
}

interface AuthorizedCall {
  conversationId: string;
  type: CallType;
  status: CallStatus;
  startedAt: Date | null;
}

/**
 * Resolves a call the caller is entitled to act on.
 *
 * Returns null after sending the error frame, so handlers can `return` on null.
 */
async function authorizeCall(ctx: WsContext, callId: string): Promise<AuthorizedCall | null> {
  const call = await findCall(callId);
  if (!call) {
    sendError(ctx.socket, "Call not found");
    return null;
  }
  if (!call.conversationId) {
    sendError(ctx.socket, "Call is not attached to a conversation");
    return null;
  }
  if (!(await isConversationMember(call.conversationId, ctx.user.id))) {
    sendError(ctx.socket, "Not a member of this conversation");
    return null;
  }
  return {
    conversationId: call.conversationId,
    type: call.type,
    status: call.status,
    startedAt: call.startedAt,
  };
}

export const callHandlers: MessageHandlers = {
  initiate_call: defineHandler(initiateCallSchema, async (ctx, payload) => {
    const conversationId = payload.conversation_id;

    if (!(await isConversationMember(conversationId, ctx.user.id))) {
      sendError(ctx.socket, "Not a member of this conversation");
      return;
    }

    const members = await prisma.conversationMember.findMany({
      where: { conversationId, leftAt: null, userId: { not: ctx.user.id } },
      select: { userId: true, user: { select: { role: true } } },
    });

    // The caller must be allowed to call every other member of the thread.
    if (members.some((member) => !canCall(ctx.user.role, member.user.role))) {
      sendError(ctx.socket, "You do not have permission to call members of this conversation.");
      return;
    }

    const call = await prisma.call.create({
      data: {
        conversationId,
        initiatedById: ctx.user.id,
        type: payload.call_type,
        status: "initiated",
        startedAt: new Date(),
        participants: {
          create: [ctx.user.id, ...members.map((member) => member.userId)].map((userId) => ({
            userId,
          })),
        },
      },
      select: { id: true },
    });

    const online = getOnlineUserIds();
    let anyReceiverOnline = false;

    for (const member of members) {
      if (online.has(member.userId)) anyReceiverOnline = true;
      broadcast(member.userId, {
        type: "incoming_call",
        payload: {
          call_id: call.id,
          caller_id: ctx.user.id,
          caller_name: ctx.user.fullName,
          call_type: payload.call_type,
          conversation_id: conversationId,
        },
      });
    }

    // INTEGRATION: ring the members who are not connected. Old call:
    // notifyIncomingCall(userId, callerName, callType, callId, conversationId)
    // for every member absent from getOnlineUserIds(). That set is `online`
    // above, so the offline recipients are
    // members.filter((m) => !online.has(m.userId)).

    send(ctx.socket, {
      type: "call_initiated",
      payload: { call_id: call.id, any_receiver_online: anyReceiverOnline },
    });

    await logCallEvent({
      conversationId,
      actorId: ctx.user.id,
      actorName: ctx.user.fullName,
      content: payload.call_type === "video" ? "🎥 Video call started" : "📞 Voice call started",
    });
  }),

  call_accepted: defineHandler(callScopedSchema, async (ctx, payload) => {
    const call = await authorizeCall(ctx, payload.call_id);
    if (!call) return;

    await prisma.call.update({
      where: { id: payload.call_id },
      data: { status: "answered", startedAt: call.startedAt ?? new Date() },
    });

    await broadcastToConversation(call.conversationId, {
      type: "call_accepted",
      payload: { call_id: payload.call_id, accepted_by: ctx.user.id },
    });
  }),

  /**
   * Sent by the callee's device the moment the incoming-call screen appears, so
   * the caller's UI can move from "Calling" to "Ringing".
   */
  call_ringing: defineHandler(callScopedSchema, async (ctx, payload) => {
    const call = await authorizeCall(ctx, payload.call_id);
    if (!call) return;

    await broadcastToConversation(
      call.conversationId,
      {
        type: "call_ringing",
        payload: { call_id: payload.call_id, ringing_user_id: ctx.user.id },
      },
      ctx.user.id,
    );
  }),

  call_declined: defineHandler(callScopedSchema, async (ctx, payload) => {
    const call = await authorizeCall(ctx, payload.call_id);
    if (!call) return;

    await broadcastToConversation(call.conversationId, {
      type: "call_declined",
      payload: { call_id: payload.call_id, declined_by: ctx.user.id },
    });

    // Both ends of a group call may decline. Recording the outcome twice would
    // also post the system message twice, which the old server did.
    if (call.status === "declined" || call.status === "ended") return;

    await prisma.call.update({
      where: { id: payload.call_id },
      data: { status: "declined", endedAt: new Date() },
    });

    await logCallEvent({
      conversationId: call.conversationId,
      actorId: ctx.user.id,
      actorName: ctx.user.fullName,
      content: call.type === "video" ? "🎥 Video call declined" : "📞 Voice call declined",
    });
  }),

  end_call: defineHandler(callScopedSchema, async (ctx, payload) => {
    const call = await authorizeCall(ctx, payload.call_id);
    if (!call) return;

    await broadcastToConversation(call.conversationId, {
      type: "call_ended",
      payload: { call_id: payload.call_id },
    });

    if (call.status === "declined" || call.status === "ended") return;

    // Computed here rather than with EXTRACT(EPOCH FROM ...) in SQL, which is
    // what the raw query did.
    const endedAt = new Date();
    const durationSeconds = call.startedAt
      ? Math.max(0, Math.floor((endedAt.getTime() - call.startedAt.getTime()) / 1000))
      : null;

    await prisma.call.update({
      where: { id: payload.call_id },
      data: { status: "ended", endedAt, durationSeconds },
    });

    const suffix = durationSeconds && durationSeconds > 0 ? ` (${formatDuration(durationSeconds)})` : "";
    await logCallEvent({
      conversationId: call.conversationId,
      actorId: ctx.user.id,
      actorName: ctx.user.fullName,
      content:
        call.type === "video" ? `🎥 Video call ended${suffix}` : `📞 Voice call ended${suffix}`,
    });
  }),

  webrtc_offer: defineHandler(webrtcSdpSchema, async (ctx, payload) => {
    await relaySdp(ctx, "webrtc_offer", payload);
  }),

  webrtc_answer: defineHandler(webrtcSdpSchema, async (ctx, payload) => {
    await relaySdp(ctx, "webrtc_answer", payload);
  }),

  webrtc_ice_candidate: defineHandler(webrtcIceSchema, async (ctx, payload) => {
    if (!(await bothInCall(payload.call_id, ctx.user.id, payload.target_user_id))) {
      sendError(ctx.socket, "Not a participant of this call");
      return;
    }
    broadcast(payload.target_user_id, {
      type: "webrtc_ice_candidate",
      payload: {
        from_user_id: ctx.user.id,
        call_id: payload.call_id,
        candidate: payload.candidate,
      },
    });
  }),
};

async function relaySdp(
  ctx: WsContext,
  type: "webrtc_offer" | "webrtc_answer",
  payload: { call_id: string; target_user_id: string; sdp: { type: string; sdp: string } },
): Promise<void> {
  if (!(await bothInCall(payload.call_id, ctx.user.id, payload.target_user_id))) {
    sendError(ctx.socket, "Not a participant of this call");
    return;
  }
  broadcast(payload.target_user_id, {
    type,
    payload: {
      from_user_id: ctx.user.id,
      call_id: payload.call_id,
      sdp: payload.sdp,
    },
  });
}
