import { randomInt, timingSafeEqual } from "node:crypto";

import { getRedis, redisKeys } from "../../config/redis";
import { normalizeEmail } from "../../lib/normalize";

/**
 * One-time codes, held in Redis.
 *
 * Replaces a process-local `Map` that lost every pending code on restart, could
 * not work behind more than one worker, and was never pruned so it grew without
 * bound. Redis gives expiry for free and is shared across instances.
 *
 * Codes are never returned in an HTTP response and never logged. The old
 * implementation did both: it echoed the live code back as `dev_otp` whenever
 * NODE_ENV was not exactly "production", and printed every code to stdout
 * unconditionally.
 */

export type OtpPurpose = "login" | "register" | "session";

const TTL_SECONDS = 10 * 60;
const MAX_ATTEMPTS = 5;

/** Six digits, from a cryptographically secure source. */
function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export interface IssuedOtp {
  code: string;
  expiresInSeconds: number;
}

export async function issueOtp(purpose: OtpPurpose, email: string): Promise<IssuedOtp> {
  const redis = await getRedis();
  const key = redisKeys.otp(purpose, normalizeEmail(email));
  const code = generateCode();

  await redis.set(key, code, { expiration: { type: "EX", value: TTL_SECONDS } });
  await redis.del(redisKeys.otpAttempts(purpose, normalizeEmail(email)));

  return { code, expiresInSeconds: TTL_SECONDS };
}

export type OtpResult =
  | { ok: true }
  | { ok: false; reason: "missing" | "expired" | "mismatch" | "too_many_attempts" };

/** Constant-time compare so a wrong code cannot be narrowed by timing. */
function codesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Verifies and consumes a code. A correct code is single use.
 *
 * Attempts are counted per account, so a six-digit code cannot be brute forced
 * by rotating source IPs past the per-IP rate limiter.
 */
export async function consumeOtp(
  purpose: OtpPurpose,
  email: string,
  submitted: string,
): Promise<OtpResult> {
  const redis = await getRedis();
  const normalized = normalizeEmail(email);
  const key = redisKeys.otp(purpose, normalized);
  const attemptsKey = redisKeys.otpAttempts(purpose, normalized);

  const attempts = await redis.incr(attemptsKey);
  if (attempts === 1) {
    await redis.expire(attemptsKey, TTL_SECONDS);
  }
  if (attempts > MAX_ATTEMPTS) {
    await redis.del(key);
    return { ok: false, reason: "too_many_attempts" };
  }

  const stored = await redis.get(key);
  if (stored === null) return { ok: false, reason: "missing" };

  if (!codesMatch(stored, submitted.trim())) {
    return { ok: false, reason: "mismatch" };
  }

  await redis.del(key);
  await redis.del(attemptsKey);
  return { ok: true };
}

export function otpFailureMessage(reason: Exclude<OtpResult, { ok: true }>["reason"]): string {
  switch (reason) {
    case "missing":
      return "No verification code found or it has expired. Please request a new one.";
    case "expired":
      return "Verification code expired. Please request a new one.";
    case "too_many_attempts":
      return "Too many incorrect attempts. Please request a new code.";
    case "mismatch":
      return "Invalid verification code.";
  }
}
