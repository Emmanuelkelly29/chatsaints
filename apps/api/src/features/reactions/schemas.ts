import { z } from "zod";

/**
 * Request validation for message reactions.
 *
 * The emoji allowlist was already the intent of the old controller, but only
 * `POST` enforced it: `DELETE /:emoji` interpolated whatever arrived in the path
 * into a query, and `GET` validated nothing at all.
 */

const uuid = z.string().uuid();

/** Ten reactions, matching the client's picker. The column is VARCHAR(10). */
export const ALLOWED_EMOJIS = [
  "👍",
  "❤️",
  "😂",
  "😮",
  "😢",
  "🙏",
  "🔥",
  "✅",
  "👏",
  "💙",
] as const;

const emoji = z.enum(ALLOWED_EMOJIS, {
  message: `Emoji not allowed. Use one of: ${ALLOWED_EMOJIS.join(" ")}`,
});

/**
 * The router mounts under `/messages/:id/reactions`, so the message id arrives
 * as a parent route parameter via `mergeParams`.
 */
export const reactionMessageParams = z.object({ id: uuid });

export const reactionParams = z.object({ id: uuid, emoji });

export const addReactionSchema = z.object({ emoji });

export type ReactionEmoji = z.infer<typeof emoji>;
