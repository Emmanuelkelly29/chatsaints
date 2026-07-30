import { WebSocket } from "ws";

import { getRedis, redisKeys } from "../config/redis";
import { describeError, logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import type { OutboundMessage } from "./protocol";

/**
 * The socket registry and presence.
 *
 * One user may hold several sockets at once (phone plus a second device, or a
 * reconnect that raced the old socket's close), so the map is
 * `userId -> Set<WebSocket>`. Sockets are removed on `close` and on `error`, and
 * the heartbeat in server.ts terminates any socket that stops answering pings,
 * which is what stops the map from filling up with half-open connections.
 */

const userSockets = new Map<string, Set<WebSocket>>();

/**
 * Slightly longer than three heartbeat intervals, so a live connection never
 * looks offline between refreshes.
 */
const ONLINE_TTL_SECONDS = 100;

export function addSocket(userId: string, socket: WebSocket): void {
  const existing = userSockets.get(userId);
  if (existing) {
    existing.add(socket);
    return;
  }
  userSockets.set(userId, new Set([socket]));
}

/**
 * Removes a socket. Returns true when it was the user's last one, which is the
 * signal to clear presence. Safe to call more than once for the same socket.
 */
export function removeSocket(userId: string, socket: WebSocket): boolean {
  const sockets = userSockets.get(userId);
  if (!sockets?.delete(socket)) return false;
  if (sockets.size > 0) return false;
  userSockets.delete(userId);
  return true;
}

/** Empties the registry. Only used during shutdown. */
export function removeAllSockets(): void {
  userSockets.clear();
}

export function getOnlineUserIds(): Set<string> {
  return new Set(userSockets.keys());
}

export function isOnline(userId: string): boolean {
  return userSockets.has(userId);
}

export function onlineUserCount(): number {
  return userSockets.size;
}

/** Delivers a frame to every socket a user currently holds. */
export function broadcast(userId: string, data: OutboundMessage): void {
  const sockets = userSockets.get(userId);
  if (!sockets) return;
  const encoded = JSON.stringify(data);
  for (const socket of sockets) {
    if (socket.readyState === WebSocket.OPEN) socket.send(encoded);
  }
}

/** Fan-out helper. `exclude` is normally the sender. */
export function broadcastToUsers(
  userIds: Iterable<string>,
  data: OutboundMessage,
  exclude?: string,
): void {
  for (const userId of userIds) {
    if (userId === exclude) continue;
    broadcast(userId, data);
  }
}

// ─── Presence ────────────────────────────────────────────────────────────────

/**
 * Records or clears presence. Redis holds a short-lived key so a crashed
 * instance cannot leave a user online forever; Postgres keeps `lastSeen` for the
 * "last seen at" display.
 */
export async function setUserOnline(userId: string, online: boolean): Promise<void> {
  try {
    const redis = await getRedis();
    if (online) {
      await redis.setEx(redisKeys.userOnline(userId), ONLINE_TTL_SECONDS, "1");
    } else {
      await redis.del(redisKeys.userOnline(userId));
    }
  } catch (error) {
    logger.error("presence write failed", { userId, online, ...describeError(error) });
  }

  try {
    await prisma.user.update({ where: { id: userId }, data: { lastSeen: new Date() } });
  } catch (error) {
    logger.error("last seen write failed", { userId, ...describeError(error) });
  }
}

/**
 * Re-arms the presence TTL for everyone still connected. Called from the
 * heartbeat, so presence no longer depends on the client remembering to send an
 * application-level `ping`.
 */
export async function refreshPresence(): Promise<void> {
  if (userSockets.size === 0) return;
  try {
    const redis = await getRedis();
    const pipeline = redis.multi();
    for (const userId of userSockets.keys()) {
      pipeline.setEx(redisKeys.userOnline(userId), ONLINE_TTL_SECONDS, "1");
    }
    await pipeline.exec();
  } catch (error) {
    logger.error("presence refresh failed", describeError(error));
  }
}
