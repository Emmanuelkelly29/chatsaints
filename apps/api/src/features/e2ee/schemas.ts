import { z } from "zod";

/**
 * Public-key directory request validation.
 *
 * The old controller passed `req.body` wholesale into the service, which
 * destructured `signedPreKey.keyId` and friends. A body of `{}` threw a
 * TypeError that surfaced as a 500, and there was no bound on how many keys a
 * single request could insert.
 */

/**
 * Keys arrive base64-encoded. The bound is generous enough for X25519 and
 * Ed25519 material with room to spare, and narrow enough that the column is not
 * a general-purpose blob store.
 */
const publicKeyMaterial = z
  .string()
  .trim()
  .min(16, "Key material is too short")
  .max(2048, "Key material is too long")
  .regex(/^[A-Za-z0-9+/=_-]+$/, "Key material must be base64");

/** Signal-style key ids are 24-bit unsigned integers. */
const keyId = z.number().int().min(0).max(0xff_ff_ff);

const preKey = z.object({
  keyId,
  publicKey: publicKeyMaterial,
});

/** One batch per request. A client that needs more sends more requests. */
const preKeyBatch = z.array(preKey).max(200, "Send at most 200 prekeys per request");

export const registerKeysSchema = z.object({
  registrationId: z.number().int().min(0),
  identityKey: publicKeyMaterial,
  signedPreKey: z.object({
    keyId,
    publicKey: publicKeyMaterial,
    signature: publicKeyMaterial,
  }),
  oneTimePreKeys: preKeyBatch.default([]),
});

export const uploadPreKeysSchema = z.object({
  one_time_prekeys: preKeyBatch.min(1, "one_time_prekeys must not be empty"),
});

export const userIdParamsSchema = z.object({
  userId: z.string().uuid(),
});

export type RegisterKeysInput = z.infer<typeof registerKeysSchema>;
export type UploadPreKeysInput = z.infer<typeof uploadPreKeysSchema>;
