import { z } from "zod";

import { StatusMediaType, StatusVisibility } from "../../generated/prisma/enums";

/**
 * Request validation for the status surface.
 *
 * The old controller read a dozen fields off `req.body` with hand-rolled
 * checks: `media_type` was compared against a literal array, `duration_secs` was
 * parseInt'd and then both rejected and clamped, and `visibility_user_ids` was
 * assumed to be an array (`visibility_user_ids.length` on a string body would
 * have thrown a 500).
 */

const mediaType = z.enum([
  StatusMediaType.image,
  StatusMediaType.video,
  StatusMediaType.voice,
  StatusMediaType.text,
]);

const visibility = z.enum([
  StatusVisibility.everyone,
  StatusVisibility.contacts_only,
  StatusVisibility.selected,
  StatusVisibility.except,
]);

/** background_color lands in a VARCHAR(20). Only hex literals are accepted. */
const hexColor = z
  .string()
  .trim()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, "background_color must be a hex colour");

/**
 * Statuses are short-form and expire in 24 hours. 120 seconds is the ceiling the
 * old code enforced for video; there is no reason for an image or a voice note
 * to outlast that, and an unbounded value is a client-side denial of service on
 * whoever watches the feed.
 */
const durationSecs = z.coerce.number().int().min(1).max(120);

export const createStatusSchema = z
  .object({
    media_url: z.string().trim().min(1).max(2048).optional(),
    media_type: mediaType.default(StatusMediaType.image),
    caption: z.string().trim().max(700).optional(),
    text_content: z.string().trim().min(1).max(700).optional(),
    // Left optional on purpose. The column is NOT NULL with a default of
    // #0A1628, and the old code passed `background_color || null`, which
    // defeated the default and wrote NULL. Omitting the key lets the default win.
    background_color: hexColor.optional(),
    visibility: visibility.optional(),
    visibility_user_ids: z.array(z.string().uuid()).max(500).default([]),
    duration_secs: durationSecs.default(5),
  })
  .superRefine((value, ctx) => {
    const isText = value.media_type === StatusMediaType.text;

    if (!isText && !value.media_url) {
      ctx.addIssue({
        code: "custom",
        path: ["media_url"],
        message:
          "media_url is required for image, video and voice statuses. Upload the file first via /api/media/upload",
      });
    }
    if (isText && !value.text_content) {
      ctx.addIssue({
        code: "custom",
        path: ["text_content"],
        message: "text_content is required for text statuses",
      });
    }
    // A 'selected' status with an empty list is visible to nobody, which is
    // never what the caller meant. The old code stored it silently.
    if (value.visibility === StatusVisibility.selected && value.visibility_user_ids.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["visibility_user_ids"],
        message: "Selected visibility requires at least one user id",
      });
    }
  });

/**
 * Recording a view needs no body at all, so an absent one parses to `{}`. The
 * old handler read `req.body.stealth` directly, which threw on a request with no
 * body and turned a legitimate call into a 500.
 */
export const viewStatusSchema = z
  .object({
    /** Overrides the account's stealth preference for this one view. */
    stealth: z.boolean().optional(),
  })
  .default({});

export const statusSettingsSchema = z
  .object({
    stealth_status_view: z.boolean().optional(),
    status_visibility_default: visibility.optional(),
  })
  .refine(
    (value) =>
      value.stealth_status_view !== undefined || value.status_visibility_default !== undefined,
    { message: "Provide stealth_status_view or status_visibility_default" },
  );

export const statusIdSchema = z.object({
  id: z.string().uuid("A status id must be a UUID"),
});

export type CreateStatusInput = z.infer<typeof createStatusSchema>;
export type StatusSettingsInput = z.infer<typeof statusSettingsSchema>;
