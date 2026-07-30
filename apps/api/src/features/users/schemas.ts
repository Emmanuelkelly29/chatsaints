import { z } from "zod";

import { normalizeEmail, normalizePersonName, normalizeText } from "../../lib/normalize";

/**
 * Request validation for the user surface.
 *
 * The old controllers read `req.body` directly and fed it into a single
 * `UPDATE users SET ... COALESCE(...)` statement. Nothing constrained the
 * shape, nothing normalized the values, and nothing rejected extra keys.
 */

const email = z
  .string()
  .trim()
  .min(3)
  .max(150)
  .email("A valid email address is required")
  .transform(normalizeEmail);

const fullName = z
  .string()
  .trim()
  .min(2, "Full name is required")
  .max(120)
  .transform(normalizePersonName);

const bio = z.string().trim().max(500, "Bio must be at most 500 characters").transform(normalizeText);

/**
 * Stored media URLs are rendered by clients, so the column must never hold a
 * `javascript:` or `data:` URI. Uploads return an absolute app path, so both
 * that and an http(s) URL are accepted and nothing else.
 */
const mediaUrl = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine((value) => /^https?:\/\//i.test(value) || value.startsWith("/"), {
    message: "Profile photo must be an http(s) URL or an absolute path",
  });

/**
 * The complete set of fields a person may change on their own account.
 *
 * This is the mass-assignment fix. The old handler's field list happened to be
 * narrow, but nothing enforced it: the update was hand-built SQL, so widening
 * it later was a one-line accident away. `strictObject` goes further than
 * ignoring unknown keys, it rejects them, so an attempt to send `role`,
 * `is_approved`, `status`, `stake_id`, `district_id` or `mission_id` fails
 * loudly with a 400 instead of silently succeeding at nothing.
 *
 * Privilege, geography and approval state are deliberately absent and belong to
 * leader or admin routes.
 */
export const updateMeSchema = z
  .strictObject({
    full_name: fullName.optional(),
    // Explicit null clears the value. `undefined` leaves it untouched.
    bio: bio.nullish(),
    email: email.nullish(),
    profile_photo_url: mediaUrl.nullish(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "No updatable fields provided",
  });

/**
 * Search input. Not `strictObject`: query strings pick up unrelated parameters
 * from clients and proxies, and rejecting those would be hostile.
 */
export const searchQuerySchema = z.object({
  q: z.string().trim().min(2, "Search query must be at least 2 characters").max(80),
  // The old query had a hard-coded LIMIT 50 and no way to ask for less.
  limit: z.coerce.number().int().min(1).max(50).default(50),
});

/**
 * A uuid check here is what stops `GET /users/search` style paths from falling
 * through to the `/:id` route, and stops a malformed id reaching the database.
 */
export const userIdParamSchema = z.object({
  id: z.string().uuid("A valid user id is required"),
});

export type UpdateMeInput = z.infer<typeof updateMeSchema>;
export type SearchQuery = z.infer<typeof searchQuerySchema>;
