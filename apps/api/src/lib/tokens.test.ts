import { describe, expect, test } from "bun:test";
import jwt from "jsonwebtoken";

import { env } from "../config/env";
import {
  ExpiredTokenError,
  InvalidTokenError,
  signAccessToken,
  verifyAccessToken,
} from "./tokens";

const USER_ID = "3f1c8a10-0f5f-4a7a-9b6a-2f5f9a1d4c33";

describe("round trip", () => {
  test("a signed token verifies back to the same user", () => {
    expect(verifyAccessToken(signAccessToken(USER_ID)).userId).toBe(USER_ID);
  });
});

describe("rejects tampering", () => {
  test("garbage is not a token", () => {
    expect(() => verifyAccessToken("not.a.jwt")).toThrow(InvalidTokenError);
  });

  test("a token signed with a different secret is rejected", () => {
    const forged = jwt.sign({ userId: USER_ID }, "some-other-secret-entirely", {
      algorithm: "HS256",
    });
    expect(() => verifyAccessToken(forged)).toThrow(InvalidTokenError);
  });

  test("an expired token is reported as expired, not merely invalid", () => {
    const stale = jwt.sign({ userId: USER_ID }, env.JWT_SECRET, {
      algorithm: "HS256",
      expiresIn: "-1s",
    });
    expect(() => verifyAccessToken(stale)).toThrow(ExpiredTokenError);
  });
});

describe("algorithm confusion", () => {
  test("an alg:none token is rejected", () => {
    // Verifying without an `algorithms` allowlist lets the attacker pick the
    // algorithm from the token header. The old middleware did exactly that.
    const unsigned = `${Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString(
      "base64url",
    )}.${Buffer.from(JSON.stringify({ userId: USER_ID })).toString("base64url")}.`;
    expect(() => verifyAccessToken(unsigned)).toThrow(InvalidTokenError);
  });

  test("an HMAC token claiming a different algorithm is rejected", () => {
    const hs512 = jwt.sign({ userId: USER_ID }, env.JWT_SECRET, { algorithm: "HS512" });
    expect(() => verifyAccessToken(hs512)).toThrow(InvalidTokenError);
  });
});

describe("payload is validated, not trusted", () => {
  test("a token with no userId is rejected", () => {
    const empty = jwt.sign({ somethingElse: true }, env.JWT_SECRET, { algorithm: "HS256" });
    expect(() => verifyAccessToken(empty)).toThrow(InvalidTokenError);
  });

  test("a non-string userId is rejected", () => {
    // The old middleware read `decoded.userId` straight off an `any`, so a
    // numeric or object userId flowed into the database query unchecked.
    for (const value of [42, null, { id: USER_ID }, ["x"], true]) {
      const token = jwt.sign({ userId: value }, env.JWT_SECRET, { algorithm: "HS256" });
      expect(() => verifyAccessToken(token)).toThrow(InvalidTokenError);
    }
  });

  test("an empty-string userId is rejected", () => {
    const token = jwt.sign({ userId: "" }, env.JWT_SECRET, { algorithm: "HS256" });
    expect(() => verifyAccessToken(token)).toThrow(InvalidTokenError);
  });
});
