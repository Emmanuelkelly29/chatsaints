import { z } from "zod";

/**
 * Request validation for the message surface.
 *
 * The old handler did `Math.min(parseInt(req.query.limit) || 50, 100)` for the
 * limit and passed `new Date(req.query.before)` straight through, so an
 * unparseable cursor became `Invalid Date` and reached Postgres as such.
 */

const uuid = z.string().uuid();

export const conversationMessagesParams = z.object({ conversationId: uuid });

export const messageParams = z.object({ id: uuid });

export const messageListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.coerce.date().optional(),
});

export type MessageListQuery = z.infer<typeof messageListQuery>;
