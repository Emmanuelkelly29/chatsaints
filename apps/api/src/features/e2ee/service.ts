import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { forbidden, notFound } from "../../middleware/errorHandler";
import type { RegisterKeysInput, UploadPreKeysInput } from "./schemas";

/**
 * PUBLIC-KEY DIRECTORY
 *
 * What these endpoints are: a store of users' *public* key material, so a client
 * that wants to start an encrypted session has something to start it with.
 * Identity keys, signed prekeys and one-time prekeys are all public by
 * construction; no private key is ever sent here.
 *
 * What they are not: end-to-end encryption. Nothing in this application
 * encrypts message bodies. `Message.content` is stored as plaintext and the
 * server reads it freely. The old service file opened with a long comment
 * asserting that "the server stores and routes encrypted ciphertext — it cannot
 * decrypt messages", which was not true of this codebase and is exactly the kind
 * of claim that stops people from asking. If and when clients do encrypt, that
 * comment can come back with a migration behind it.
 *
 * The message queue below stores whatever bytes a client hands it. That payload
 * is opaque to the server, which is a statement about this table, not about the
 * application's messaging.
 */

const REPLENISH_THRESHOLD = 10;

/**
 * A relationship that justifies handing over a key bundle.
 *
 * Duplicated rather than shared with the calls feature, which needs the same
 * predicate: features do not import from one another, and a copy with a comment
 * is cheaper to reason about than a premature abstraction over two call sites.
 */
async function hasRelationship(userId: string, otherId: string): Promise<boolean> {
  const userLowId = userId < otherId ? userId : otherId;
  const userHighId = userId < otherId ? otherId : userId;

  const connection = await prisma.contactConnection.findUnique({
    where: { userLowId_userHighId: { userLowId, userHighId } },
    select: { id: true },
  });
  if (connection) return true;

  const shared = await prisma.conversationMember.findFirst({
    where: {
      userId: otherId,
      leftAt: null,
      conversation: { members: { some: { userId, leftAt: null } } },
    },
    select: { id: true },
  });
  return shared !== null;
}

export interface RegisterKeysResult {
  registered: true;
  oneTimePreKeysAdded: number;
  oneTimePreKeysRemaining: number;
}

/**
 * Registers or rotates a user's published key material.
 *
 * One transaction, so a client cannot end up with a new identity key and the
 * previous signed prekey.
 */
export async function registerKeyBundle(
  userId: string,
  input: RegisterKeysInput,
): Promise<RegisterKeysResult> {
  const added = await prisma.$transaction(async (tx) => {
    await tx.e2eeIdentityKey.upsert({
      where: { userId },
      create: {
        userId,
        registrationId: input.registrationId,
        identityKeyPublic: input.identityKey,
      },
      update: {
        registrationId: input.registrationId,
        identityKeyPublic: input.identityKey,
      },
      select: { userId: true },
    });

    await tx.e2eeSignedPreKey.upsert({
      where: { userId_keyId: { userId, keyId: input.signedPreKey.keyId } },
      create: {
        userId,
        keyId: input.signedPreKey.keyId,
        publicKey: input.signedPreKey.publicKey,
        signature: input.signedPreKey.signature,
      },
      update: {
        publicKey: input.signedPreKey.publicKey,
        signature: input.signedPreKey.signature,
      },
      select: { id: true },
    });

    if (input.oneTimePreKeys.length === 0) return 0;

    const result = await tx.e2eeOneTimePreKey.createMany({
      data: input.oneTimePreKeys.map((key) => ({
        userId,
        keyId: key.keyId,
        publicKey: key.publicKey,
      })),
      skipDuplicates: true,
    });
    return result.count;
  });

  logger.info("key bundle registered", { userId, oneTimePreKeysAdded: added });

  return {
    registered: true,
    oneTimePreKeysAdded: added,
    oneTimePreKeysRemaining: await countUnusedPreKeys(userId),
  };
}

async function countUnusedPreKeys(userId: string): Promise<number> {
  return prisma.e2eeOneTimePreKey.count({ where: { userId, used: false } });
}

export interface PreKeyStatus {
  oneTimePreKeysRemaining: number;
  needsReplenishment: boolean;
}

export async function preKeyStatus(userId: string): Promise<PreKeyStatus> {
  const remaining = await countUnusedPreKeys(userId);
  return { oneTimePreKeysRemaining: remaining, needsReplenishment: remaining < REPLENISH_THRESHOLD };
}

export async function addOneTimePreKeys(
  userId: string,
  input: UploadPreKeysInput,
): Promise<{ added: number; oneTimePreKeysRemaining: number }> {
  const result = await prisma.e2eeOneTimePreKey.createMany({
    data: input.one_time_prekeys.map((key) => ({
      userId,
      keyId: key.keyId,
      publicKey: key.publicKey,
    })),
    skipDuplicates: true,
  });

  // The old handler reported `{ added: oneTimePreKeys.length }` regardless of how
  // many rows the ON CONFLICT DO NOTHING actually inserted, so a client that
  // resent a batch was told it had replenished when it had not.
  return { added: result.count, oneTimePreKeysRemaining: await countUnusedPreKeys(userId) };
}

/**
 * Claims one unused one-time prekey.
 *
 * The old query did this with `FOR UPDATE SKIP LOCKED` inside an UPDATE
 * subselect. The same guarantee without raw SQL: read a candidate, then claim it
 * with a conditional update that only matches while it is still unused. A lost
 * race means somebody else took that key, so try the next one.
 */
async function claimOneTimePreKey(
  userId: string,
): Promise<{ keyId: number; publicKey: string } | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const candidate = await prisma.e2eeOneTimePreKey.findFirst({
      where: { userId, used: false },
      orderBy: { keyId: "asc" },
      select: { id: true, keyId: true, publicKey: true },
    });
    if (!candidate) return null;

    const claimed = await prisma.e2eeOneTimePreKey.updateMany({
      where: { id: candidate.id, used: false },
      data: { used: true },
    });
    if (claimed.count === 1) {
      return { keyId: candidate.keyId, publicKey: candidate.publicKey };
    }
  }
  return null;
}

export interface KeyBundle {
  userId: string;
  registrationId: number;
  identityKey: string;
  signedPreKey: { keyId: number; publicKey: string; signature: string } | null;
  oneTimePreKey: { keyId: number; publicKey: string } | null;
}

/**
 * Hands a caller the key bundle they need to open a session with someone.
 *
 * Two things about this endpoint are worth stating plainly, because the old one
 * had neither:
 *
 *   1. It CONSUMES a one-time prekey per call, by design: single use is the whole
 *      point of the prekey. The old route sat behind `authenticate` alone with no
 *      relationship check, so any account could burn through any target's entire
 *      prekey supply in a loop. Once exhausted, sessions with that user fall back
 *      to the signed prekey and lose forward secrecy for the initial message.
 *      That is a denial-of-service with a cryptographic downgrade attached.
 *
 *      The fix has two halves: this relationship requirement, and a per-caller
 *      rate limit in routes.ts. Neither alone is enough.
 *
 *   2. Requesting your own bundle does not consume a prekey. Clients poll their
 *      own state; there is no reason for that to cost anything.
 */
export async function fetchKeyBundle(callerId: string, targetId: string): Promise<KeyBundle> {
  const isSelf = callerId === targetId;

  if (!isSelf && !(await hasRelationship(callerId, targetId))) {
    throw forbidden("You can only fetch keys for people you are already connected to.");
  }

  const identity = await prisma.e2eeIdentityKey.findUnique({
    where: { userId: targetId },
    select: { registrationId: true, identityKeyPublic: true },
  });
  if (!identity) {
    throw notFound("That user has not published any keys.");
  }

  const signedPreKey = await prisma.e2eeSignedPreKey.findFirst({
    where: { userId: targetId },
    orderBy: { keyId: "desc" },
    select: { keyId: true, publicKey: true, signature: true },
  });

  const oneTimePreKey = isSelf ? null : await claimOneTimePreKey(targetId);

  return {
    userId: targetId,
    registrationId: identity.registrationId,
    identityKey: identity.identityKeyPublic,
    signedPreKey,
    oneTimePreKey,
  };
}

export interface QueuedMessage {
  id: string;
  senderId: string | null;
  ciphertext: string;
  createdAt: Date;
}

/**
 * Drains the caller's queue of stored payloads.
 *
 * Read-and-delete in one transaction, matching the old `DELETE ... RETURNING`.
 * Note the consequence, which the old code did not: a client that receives the
 * response and then crashes before persisting it loses those payloads for good.
 * Fixing that needs an acknowledgement round trip and a column to track it.
 */
export async function drainQueue(userId: string): Promise<{ messages: QueuedMessage[] }> {
  const messages = await prisma.$transaction(async (tx) => {
    const rows = await tx.e2eeQueuedMessage.findMany({
      where: { recipientId: userId },
      orderBy: { createdAt: "asc" },
      select: { id: true, senderId: true, ciphertext: true, createdAt: true },
    });
    if (rows.length === 0) return rows;

    await tx.e2eeQueuedMessage.deleteMany({
      where: { id: { in: rows.map((row) => row.id) } },
    });
    return rows;
  });

  return { messages };
}
