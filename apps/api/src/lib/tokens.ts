import jwt, { type JwtPayload, type SignOptions } from "jsonwebtoken";

import { env } from "../config/env";

/**
 * Access token issue and verify.
 *
 * Two hardening choices worth naming:
 *
 *   - The algorithm is pinned to HS256 on both sign and verify. Verifying
 *     without an `algorithms` allowlist lets an attacker choose the algorithm
 *     from the token header, which is the classic JWT confusion attack.
 *   - The decoded payload is validated structurally rather than trusted. The
 *     old middleware read `decoded.userId` straight off an `any`.
 */

const ALGORITHM = "HS256" as const;

export interface AccessTokenPayload {
  userId: string;
}

export function signAccessToken(userId: string): string {
  const options: SignOptions = {
    algorithm: ALGORITHM,
    expiresIn: env.JWT_EXPIRES_IN as SignOptions["expiresIn"],
  };
  return jwt.sign({ userId }, env.JWT_SECRET, options);
}

export class InvalidTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTokenError";
  }
}

export class ExpiredTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpiredTokenError";
  }
}

function isAccessTokenPayload(value: string | JwtPayload): value is JwtPayload & AccessTokenPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    "userId" in value &&
    typeof (value as { userId: unknown }).userId === "string" &&
    (value as { userId: string }).userId.length > 0
  );
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  let decoded: string | JwtPayload;
  try {
    decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: [ALGORITHM] });
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new ExpiredTokenError("Token expired");
    }
    throw new InvalidTokenError("Invalid token");
  }

  if (!isAccessTokenPayload(decoded)) {
    throw new InvalidTokenError("Malformed token payload");
  }

  return { userId: decoded.userId };
}
