import { z } from "zod";

import { CallType, MessageType } from "../generated/prisma/enums";

/**
 * Inbound payload schemas, one per message type.
 *
 * Keys are the snake_case names the Flutter client sends. Nothing here renames
 * a field: the wire protocol is fixed by the shipped app.
 *
 * Two things are deliberately validated that the old server never checked:
 *
 *   - identifiers are UUIDs, so a malformed id fails at the boundary instead of
 *     inside a query;
 *   - relayed WebRTC blobs are shaped and length-capped rather than forwarded
 *     verbatim, which made the server an arbitrary-JSON relay between clients.
 */

const uuid = z.string().uuid("Must be a valid id");

/** Frames whose payload carries nothing. `ping` sends `{}`. */
export const emptyPayloadSchema = z.unknown();

// ─── WebRTC blobs ────────────────────────────────────────────────────────────
// The client reads exactly these keys (RTCSessionDescription.toMap() and
// RTCIceCandidate.toMap()), so nothing is lost by describing them precisely.

const sdpSchema = z.object({
  type: z.string().max(20),
  sdp: z.string().max(64_000),
});

const iceCandidateSchema = z.object({
  candidate: z.string().max(4_000),
  sdpMid: z.string().max(64).nullish(),
  sdpMLineIndex: z.number().int().min(0).max(1_000).nullish(),
});

// ─── Chat ────────────────────────────────────────────────────────────────────

/** Guards against a single frame pushing an unbounded body into the database. */
const MESSAGE_CONTENT_LIMIT = 10_000;

export const sendMessageSchema = z
  .object({
    conversation_id: uuid,
    content: z.string().max(MESSAGE_CONTENT_LIMIT).nullish(),
    message_type: z.enum(MessageType).default(MessageType.text),
    reply_to_message_id: uuid.nullish(),
    media_url: z.string().max(2_000).nullish(),
  })
  .refine(
    (value) =>
      (value.content !== null && value.content !== undefined && value.content.trim() !== "") ||
      (value.message_type !== MessageType.text &&
        value.media_url !== null &&
        value.media_url !== undefined),
    { message: "A message needs content, or media for a non-text type", path: ["content"] },
  );

export const conversationScopedSchema = z.object({ conversation_id: uuid });

export const markReadSchema = z.object({ message_id: uuid });

// ─── Presence ────────────────────────────────────────────────────────────────

export const checkOnlineSchema = z.object({
  user_ids: z.array(uuid).max(200, "Too many user ids in one request").default([]),
});

// ─── Calls ───────────────────────────────────────────────────────────────────

export const initiateCallSchema = z.object({
  conversation_id: uuid,
  call_type: z.enum(CallType),
});

/**
 * `conversation_id` is still accepted because the client sends it, but it is
 * never used. Trusting it let any authenticated user post a system message into
 * a conversation they had nothing to do with; the conversation is now read off
 * the call record instead.
 */
export const callScopedSchema = z.object({
  call_id: uuid,
  conversation_id: uuid.nullish(),
});

export const webrtcSdpSchema = z.object({
  call_id: uuid,
  target_user_id: uuid,
  sdp: sdpSchema,
});

export const webrtcIceSchema = z.object({
  call_id: uuid,
  target_user_id: uuid,
  candidate: iceCandidateSchema,
});

// ─── Meetings ────────────────────────────────────────────────────────────────

export const meetingScopedSchema = z.object({ meeting_id: uuid });

export const meetingTargetSchema = z.object({
  meeting_id: uuid,
  target_user_id: uuid,
});

export const transferHostSchema = z.object({
  meeting_id: uuid,
  new_host_id: uuid,
});

export const toggleScreenShareSchema = z.object({
  meeting_id: uuid,
  sharing: z.boolean().default(true),
});

export const raiseHandSchema = z.object({
  meeting_id: uuid,
  raised: z.boolean().default(true),
});

export const meetingChatSchema = z.object({
  meeting_id: uuid,
  message: z.string().trim().min(1, "Message is empty").max(2_000),
});

export const meetingWebrtcSdpSchema = z.object({
  meeting_id: uuid,
  target_user_id: uuid,
  sdp: sdpSchema,
});

export const meetingWebrtcIceSchema = z.object({
  meeting_id: uuid,
  target_user_id: uuid,
  candidate: iceCandidateSchema,
});
