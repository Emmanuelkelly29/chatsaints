import { WebSocket } from "ws";
import { z } from "zod";

import type { LeadershipRole, UserStatus } from "../generated/prisma/enums";

/**
 * Wire protocol primitives for the realtime surface.
 *
 * Every frame is a JSON object of the form `{ type, payload }`. The `type`
 * strings and the payload key names are fixed by the Flutter client
 * (apps/mobile/lib/services/websocket_service.dart), so they stay snake_case on
 * the wire even though everything inside TypeScript is camelCase.
 */

/** Columns loaded once per connection and carried on the socket. */
export interface WsUser {
  id: string;
  fullName: string;
  role: LeadershipRole;
  status: UserStatus;
  stakeId: string | null;
  missionId: string | null;
  missionaryModeActive: boolean;
}

/** An outbound frame. Payloads are always objects, or absent. */
export interface OutboundMessage {
  type: string;
  payload?: Record<string, unknown>;
}

/** Everything a handler is allowed to know about its caller. */
export interface WsContext {
  readonly socket: WebSocket;
  readonly user: WsUser;
}

export function send(socket: WebSocket, message: OutboundMessage): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(message));
}

export function sendError(socket: WebSocket, message: string): void {
  send(socket, { type: "error", payload: { message } });
}

/**
 * The envelope, validated before anything looks at `payload`.
 *
 * `type` is length-capped because it is echoed back in the unknown-type error.
 */
export const envelopeSchema = z.object({
  type: z.string().min(1).max(64),
  payload: z.unknown().optional(),
});

/** A dispatchable handler. The raw payload is `unknown` until a schema sees it. */
export type MessageHandler = (ctx: WsContext, payload: unknown) => Promise<void>;

export type MessageHandlers = Record<string, MessageHandler>;

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid payload";
  const path = issue.path.map((segment) => String(segment)).join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

/**
 * Binds a zod schema to a handler.
 *
 * This is the whole reason handlers can be trusted: the old switch destructured
 * raw JSON and passed the values straight into SQL, so `conversation_id` could
 * be anything at all. Nothing reaches a handler body now without passing its
 * schema first.
 */
export function defineHandler<S extends z.ZodType>(
  schema: S,
  run: (ctx: WsContext, payload: z.output<S>) => Promise<void>,
): MessageHandler {
  return async (ctx, payload) => {
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      sendError(ctx.socket, firstIssue(parsed.error));
      return;
    }
    await run(ctx, parsed.data);
  };
}
