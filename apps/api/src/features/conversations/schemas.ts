import { z } from "zod";

/**
 * Request validation for the conversation surface.
 *
 * The old controllers read `name`, `is_group`, `member_ids`, `description` and
 * `mission_id` straight off `req.body`. `member_ids` in particular was spread
 * into an INSERT loop with no shape check at all, so a caller could send any
 * value and either crash the handler or add whoever they liked.
 *
 * Request bodies keep the snake_case names the mobile clients already send.
 * Responses use the camelCase names Prisma produces, as in the auth feature.
 */

const uuid = z.string().uuid();

/**
 * A conversation holds at most `Conversation.maxMembers` rows, 1000 by default,
 * and the creator occupies one of them.
 */
const MAX_INVITEES = 999;

const inviteeIds = z
  .array(uuid)
  .min(1, "At least one member is required")
  .max(MAX_INVITEES, `A conversation may not exceed ${MAX_INVITEES + 1} members`)
  // Duplicates in the request would previously have hit the unique constraint
  // mid-loop, leaving a half-populated conversation behind.
  .transform((ids) => [...new Set(ids)]);

export const conversationParams = z.object({ id: uuid });

/**
 * Message paging. The old handler passed `req.query.limit` into the SQL LIMIT
 * unparsed, so `?limit=all` reached Postgres verbatim and `?limit=1000000` was
 * honoured.
 */
export const messageListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.coerce.date().optional(),
});

export const createConversationSchema = z
  .object({
    name: z.string().trim().min(2, "Name must be at least 2 characters").max(200).optional(),
    description: z.string().trim().max(2000).optional(),
    photo_url: z.string().trim().url().max(2048).optional(),
    is_group: z.boolean().default(false),
    member_ids: inviteeIds,
    mission_id: uuid.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.is_group && !value.name) {
      ctx.addIssue({ code: "custom", path: ["name"], message: "A group needs a name" });
    }
    // A one-to-one conversation is exactly two people. Anything else was
    // previously accepted and silently produced an unnamed pseudo-group that no
    // group endpoint could administer.
    if (!value.is_group && value.member_ids.length !== 1) {
      ctx.addIssue({
        code: "custom",
        path: ["member_ids"],
        message: "A direct conversation takes exactly one other member",
      });
    }
  });

export const startDirectSchema = z.object({ target_user_id: uuid });

export type CreateConversationInput = z.infer<typeof createConversationSchema>;
export type MessageListQuery = z.infer<typeof messageListQuery>;
