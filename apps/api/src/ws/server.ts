import type { IncomingMessage, Server as HttpServer } from "node:http";

import { WebSocket, WebSocketServer, type RawData } from "ws";

import { describeError, logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { verifyAccessToken } from "../lib/tokens";
import { callHandlers } from "./handlers/calls";
import { chatHandlers } from "./handlers/chat";
import { meetingHandlers, promoteCoHostOnDisconnect } from "./handlers/meetings";
import { presenceHandlers } from "./handlers/presence";
import {
  envelopeSchema,
  send,
  sendError,
  type MessageHandlers,
  type WsContext,
  type WsUser,
} from "./protocol";
import { addSocket, removeSocket, refreshPresence, removeAllSockets, setUserOnline } from "./registry";

/**
 * The realtime endpoint, served at /ws on the same HTTP server as the REST API.
 *
 * Responsibilities kept here: authenticating the connection, keeping the socket
 * registry honest, and dispatching frames. Everything a frame actually does lives
 * in ./handlers, and every authorization question it asks lives in ./authz.
 */

const PATH = "/ws";

/** Policy violation. Used for every authentication failure. */
const CLOSE_POLICY = 1008;

/**
 * A frame larger than this is refused by `ws` before it reaches us. Without a
 * cap, one client can make the process allocate arbitrary memory.
 */
const MAX_PAYLOAD_BYTES = 256 * 1024;

const HEARTBEAT_INTERVAL_MS = 30_000;

const BEARER_SUBPROTOCOL = "bearer";

const handlers: MessageHandlers = {
  ...presenceHandlers,
  ...chatHandlers,
  ...callHandlers,
  ...meetingHandlers,
};

/** The connection's own view of the account. Never includes credentials. */
const WS_USER_SELECT = {
  id: true,
  fullName: true,
  role: true,
  status: true,
  stakeId: true,
  missionId: true,
  missionaryModeActive: true,
} as const;

function loadUser(userId: string): Promise<WsUser | null> {
  return prisma.user.findFirst({
    where: { id: userId, status: { not: "suspended" } },
    select: WS_USER_SELECT,
  });
}

// ─── Token extraction ────────────────────────────────────────────────────────

type TokenSource = "subprotocol" | "header" | "query";

interface SuppliedToken {
  token: string;
  source: TokenSource;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value.join(",");
  return value;
}

/**
 * Finds the access token on a handshake.
 *
 * Preference order matters. `Sec-WebSocket-Protocol: bearer, <token>` and
 * `Authorization: Bearer <token>` both keep the credential out of request lines;
 * `?token=` does not, so it lands in nginx and every proxy access log in front of
 * this service, and in browser history for a web client.
 *
 * The query parameter is still accepted because the shipped Flutter client is the
 * only caller and it connects with `${wsUrl}?token=$token`. Removing it needs a
 * coordinated client release; until then each use is logged once per process.
 */
function readToken(req: IncomingMessage): SuppliedToken | null {
  const offered = headerValue(req.headers["sec-websocket-protocol"]);
  if (offered) {
    const parts = offered
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    const [scheme, token] = parts;
    if (scheme === BEARER_SUBPROTOCOL && token) {
      return { token, source: "subprotocol" };
    }
  }

  const authorization = req.headers.authorization;
  if (authorization?.startsWith("Bearer ")) {
    const token = authorization.slice("Bearer ".length).trim();
    if (token) return { token, source: "header" };
  }

  // The host is irrelevant here; only the query string is read.
  const url = new URL(req.url ?? PATH, "http://localhost");
  const queryToken = url.searchParams.get("token");
  if (queryToken) return { token: queryToken, source: "query" };

  return null;
}

let warnedAboutQueryToken = false;

function noteTokenSource(source: TokenSource): void {
  if (source !== "query" || warnedAboutQueryToken) return;
  warnedAboutQueryToken = true;
  logger.warn(
    "websocket clients are still sending the access token in the URL query string, where proxies log it; migrate them to the Sec-WebSocket-Protocol handshake",
  );
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

function decode(data: RawData): string | null {
  if (typeof data === "string") return data;
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return data.toString("utf8");
}

async function dispatch(ctx: WsContext, raw: RawData): Promise<void> {
  const text = decode(raw);
  if (text === null) {
    sendError(ctx.socket, "Unsupported frame");
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    sendError(ctx.socket, "Malformed JSON");
    return;
  }

  const envelope = envelopeSchema.safeParse(parsed);
  if (!envelope.success) {
    sendError(ctx.socket, "Every message needs a type and an optional payload object");
    return;
  }

  const handler = handlers[envelope.data.type];
  if (!handler) {
    sendError(ctx.socket, `Unknown type: ${envelope.data.type}`);
    return;
  }

  await handler(ctx, envelope.data.payload);
}

// ─── Connection lifecycle ────────────────────────────────────────────────────

/** Sockets that answered the most recent protocol-level ping. */
const responsive = new WeakSet<WebSocket>();

async function onConnection(socket: WebSocket, req: IncomingMessage): Promise<void> {
  const supplied = readToken(req);
  if (!supplied) {
    socket.close(CLOSE_POLICY, "Token required");
    return;
  }
  noteTokenSource(supplied.source);

  let userId: string;
  try {
    // Shared with the REST middleware, so the algorithm is pinned and the
    // payload shape is validated rather than trusted.
    userId = verifyAccessToken(supplied.token).userId;
  } catch {
    socket.close(CLOSE_POLICY, "Invalid token");
    return;
  }

  const user = await loadUser(userId);
  if (!user) {
    socket.close(CLOSE_POLICY, "Invalid token");
    return;
  }

  // The handshake can finish and the client vanish while the account loads.
  if (socket.readyState !== WebSocket.OPEN) return;

  const ctx: WsContext = { socket, user };

  addSocket(user.id, socket);
  responsive.add(socket);
  await setUserOnline(user.id, true);

  logger.info("ws connected", { userId: user.id, role: user.role, source: supplied.source });
  send(socket, { type: "connected", payload: { user_id: user.id } });

  socket.on("pong", () => {
    responsive.add(socket);
  });

  socket.on("message", (data: RawData) => {
    void dispatch(ctx, data).catch((error: unknown) => {
      // The client is told nothing about why. Handler internals are not the
      // caller's business, and the detail is in the log.
      logger.error("ws message failed", { userId: user.id, ...describeError(error) });
      sendError(socket, "Request failed");
    });
  });

  socket.on("error", (error: Error) => {
    logger.error("ws socket error", { userId: user.id, ...describeError(error) });
    // A socket that errored is finished, so release it now rather than waiting
    // for a close event that may never arrive.
    void disconnect(user.id, socket);
  });

  socket.on("close", () => {
    void disconnect(user.id, socket);
  });
}

/** Idempotent: whichever of `error` and `close` arrives first does the work. */
async function disconnect(userId: string, socket: WebSocket): Promise<void> {
  const wasLast = removeSocket(userId, socket);
  if (!wasLast) return;

  logger.info("ws disconnected", { userId });
  await setUserOnline(userId, false);
  await promoteCoHostOnDisconnect(userId);
}

// ─── Entry point ─────────────────────────────────────────────────────────────

let heartbeat: ReturnType<typeof setInterval> | null = null;
let server: WebSocketServer | null = null;

export function initWebSocketServer(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({
    server: httpServer,
    path: PATH,
    maxPayload: MAX_PAYLOAD_BYTES,
    // Only called when the client offers a subprotocol. Accepting "bearer" is
    // what lets a client send its token in the handshake instead of the URL.
    handleProtocols: (protocols) => (protocols.has(BEARER_SUBPROTOCOL) ? BEARER_SUBPROTOCOL : false),
  });
  server = wss;

  wss.on("connection", (socket: WebSocket, req: IncomingMessage) => {
    void onConnection(socket, req).catch((error: unknown) => {
      logger.error("ws connection setup failed", describeError(error));
      socket.close(1011, "Server error");
    });
  });

  wss.on("error", (error: Error) => {
    logger.error("ws server error", describeError(error));
  });

  /**
   * Liveness. A socket that stops answering pings is terminated, which fires
   * `close` and clears its registry entry. Without this, a client that dropped
   * off the network without a close frame would sit in the registry looking
   * online and every broadcast to it would be written into a dead buffer.
   */
  heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (!responsive.has(socket)) {
        socket.terminate();
        continue;
      }
      responsive.delete(socket);
      socket.ping();
    }
    void refreshPresence();
  }, HEARTBEAT_INTERVAL_MS);

  // Do not keep the process alive purely for the heartbeat.
  heartbeat.unref();

  wss.on("close", () => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
  });

  logger.info("websocket server ready", { path: PATH });
  return wss;
}

/** Closes every socket and stops the heartbeat. Call during shutdown. */
export async function closeWebSocketServer(): Promise<void> {
  if (heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
  const wss = server;
  if (!wss) return;
  server = null;

  for (const socket of wss.clients) {
    socket.close(1001, "Server shutting down");
  }
  removeAllSockets();

  await new Promise<void>((resolve) => {
    wss.close(() => {
      resolve();
    });
  });
}

export { broadcast, getOnlineUserIds, isOnline } from "./registry";
