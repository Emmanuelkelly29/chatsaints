import { z } from "zod";

/**
 * The old notifications router read `req.params.id` straight into a SQL
 * statement and had no pagination at all: the list was a hard-coded LIMIT 50
 * with no offset, so a user could never reach older notifications.
 */

/** Query strings arrive as strings, so numbers are coerced then bounded. */
export const listNotificationsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  unread: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});

export const notificationIdSchema = z.object({
  id: z.string().uuid("A notification id must be a UUID"),
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsSchema>;
