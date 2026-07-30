import { z } from "zod";

/**
 * Request validation for group administration.
 *
 * The old controllers checked `name.trim().length < 2` by hand and read
 * `member_ids` with a `= []` default, then trusted whatever was in it. Nothing
 * validated `is_admin`, so `PATCH .../admin` with a non-boolean body wrote that
 * value into a NOT NULL boolean column.
 *
 * Request bodies keep the snake_case names the mobile clients send. Responses
 * use the camelCase names Prisma produces.
 */

const uuid = z.string().uuid();

/** A group holds at most `Conversation.maxMembers` rows, creator included. */
const MAX_INVITEES = 999;

const inviteeIds = z
  .array(uuid)
  .max(MAX_INVITEES, `A group may not exceed ${MAX_INVITEES + 1} members`)
  .transform((ids) => [...new Set(ids)]);

const groupName = z
  .string()
  .trim()
  .min(2, "Group name must be at least 2 characters")
  .max(200, "Group name must be at most 200 characters");

export const groupParams = z.object({ id: uuid });

export const groupMemberParams = z.object({ id: uuid, userId: uuid });

export const createGroupSchema = z.object({
  name: groupName,
  description: z.string().trim().max(2000).optional(),
  photo_url: z.string().trim().url().max(2048).optional(),
  member_ids: inviteeIds.default([]),
  mission_id: uuid.optional(),
});

/**
 * Every field is optional, but at least one must be present. `null` clears a
 * nullable column, which the old COALESCE-based UPDATE could not express.
 */
export const updateGroupSchema = z
  .object({
    name: groupName.optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    photo_url: z.string().trim().url().max(2048).nullable().optional(),
    only_admins_can_message: z.boolean().optional(),
    only_admins_can_edit: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "Nothing to update",
  });

export const addMembersSchema = z.object({
  member_ids: inviteeIds.refine((ids) => ids.length > 0, "At least one member is required"),
});

export const toggleAdminSchema = z.object({ is_admin: z.boolean() });

export type CreateGroupInput = z.infer<typeof createGroupSchema>;
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;
