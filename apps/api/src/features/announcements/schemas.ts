import { z } from "zod";

import { AUDIENCE_KEYS, type AudienceKey } from "./audience";

/**
 * Request validation for announcements.
 *
 * The old route read `title` and `body` off the body with `?.trim()` truthiness
 * checks and accepted an audience value of any shape, filtering unknown entries
 * out silently. An unrecognised audience is now a 400: sending to the wrong
 * people because a key was misspelled is worse than being told the key is wrong.
 */

const audienceKey = z.enum(AUDIENCE_KEYS);

const title = z.string().trim().min(1, "title is required").max(200);

/**
 * The column is unbounded TEXT, but an announcement is fanned out to a
 * Notification row per recipient and to a push payload, so it is bounded here.
 */
const body = z.string().trim().min(1, "body is required").max(10_000);

export const createAnnouncementSchema = z
  .object({
    title,
    body,
    /** Preferred form. */
    audiences: z.array(audienceKey).max(AUDIENCE_KEYS.length).optional(),
    /** Legacy single-value form, still accepted. */
    audience: audienceKey.optional(),
  })
  .transform((value) => {
    const requested = value.audiences ?? (value.audience ? [value.audience] : []);
    const unique = [...new Set(requested)];
    // "all" subsumes everything else, and an empty selection means everyone.
    const audiences: AudienceKey[] =
      unique.length === 0 || unique.includes("all") ? ["all"] : unique;
    return { title: value.title, body: value.body, audiences };
  });

export const editAnnouncementSchema = z
  .object({
    title: title.optional(),
    body: body.optional(),
  })
  .refine((value) => value.title !== undefined || value.body !== undefined, {
    message: "Provide a title or a body to change",
  });

export const listReceivedSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  unread: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});

export const listSentSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export const announcementIdSchema = z.object({
  id: z.string().uuid("An announcement id must be a UUID"),
});

export type CreateAnnouncementInput = z.infer<typeof createAnnouncementSchema>;
export type EditAnnouncementInput = z.infer<typeof editAnnouncementSchema>;
