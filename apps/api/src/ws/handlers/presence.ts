import { defineHandler, send, type MessageHandlers } from "../protocol";
import { isOnline, setUserOnline } from "../registry";
import { checkOnlineSchema, emptyPayloadSchema } from "../schemas";

/**
 * Liveness and presence lookups.
 *
 * `ping` is the application-level keepalive the Flutter client sends every 30
 * seconds. The protocol-level ping/pong in server.ts is what actually reaps dead
 * sockets; this one exists so the client can tell it is still connected, and it
 * re-arms the presence key as a side effect.
 */

export const presenceHandlers: MessageHandlers = {
  ping: defineHandler(emptyPayloadSchema, async (ctx) => {
    await setUserOnline(ctx.user.id, true);
    send(ctx.socket, { type: "pong" });
  }),

  check_online: defineHandler(checkOnlineSchema, (ctx, payload) => {
    const status: Record<string, boolean> = {};
    for (const userId of payload.user_ids) {
      status[userId] = isOnline(userId);
    }
    send(ctx.socket, { type: "online_status", payload: status });
    return Promise.resolve();
  }),
};
