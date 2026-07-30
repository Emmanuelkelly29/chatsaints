import { createClient, type RedisClientType } from "redis";

import { env } from "./env";
import { describeError, logger } from "../lib/logger";

/**
 * Redis is used for presence and short-lived state. Configured from a single
 * REDIS_URL rather than the old REDIS_HOST / REDIS_PORT / REDIS_PASSWORD trio,
 * which is what every managed provider hands you.
 */

let client: RedisClientType | null = null;

export async function getRedis(): Promise<RedisClientType> {
  if (client?.isOpen) return client;

  client = createClient({ url: env.REDIS_URL });

  client.on("error", (error: unknown) => {
    logger.error("redis error", describeError(error));
  });

  await client.connect();
  logger.info("redis connected");
  return client;
}

export async function disconnectRedis(): Promise<void> {
  if (client?.isOpen) await client.quit();
  client = null;
}

/** Namespaced key builders. Keeps key formats in one place. */
export const redisKeys = {
  userOnline: (userId: string) => `online:${userId}`,
  pinnedChats: (userId: string) => `pinned:${userId}`,
  scriptureCurrent: () => "scripture:current",
  missionaryLock: (userId: string) => `missionary_lock:${userId}`,
  /**
   * One-time codes. These live in Redis rather than a process-local Map so they
   * survive a restart and work across more than one instance. The old
   * in-memory store lost every pending code on deploy, broke entirely behind
   * multiple workers, and was never pruned, so it grew without bound.
   */
  otp: (purpose: "login" | "register" | "session", email: string) =>
    `otp:${purpose}:${email.toLowerCase()}`,
  otpAttempts: (purpose: "login" | "register" | "session", email: string) =>
    `otp_attempts:${purpose}:${email.toLowerCase()}`,
} as const;
