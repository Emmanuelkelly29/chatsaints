import { z } from "zod";

import type { ContactRequestPreference, StatusVisibility } from "../../generated/prisma/enums";
import { normalizeEmail, normalizePersonName, normalizeText } from "../../lib/normalize";

/**
 * Request validation for the settings surface.
 *
 * Every one of these handlers used to be a `COALESCE`-per-column UPDATE built
 * from raw body fields, with two consequences worth calling out:
 *
 *   - enum columns were cast in SQL (`$2::status_visibility`), so an invalid
 *     value became a 500 from Postgres rather than a 400 from validation;
 *   - `COALESCE(x, column)` cannot distinguish "not supplied" from "set to
 *     null", so no setting could ever be cleared once set.
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

/** See the note in users/schemas.ts: keeps `javascript:` and `data:` URIs out. */
const mediaUrl = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine((value) => /^https?:\/\//i.test(value) || value.startsWith("/"), {
    message: "Profile photo must be an http(s) URL or an absolute path",
  });

/**
 * Enum values as literal tuples, checked against the generated Prisma types.
 * `satisfies` means a value that is not in the database enum fails to compile
 * here rather than at runtime in Postgres.
 */
const STATUS_VISIBILITY = ["everyone", "contacts_only", "selected", "except"] as const satisfies
  readonly StatusVisibility[];

const CONTACT_REQUEST_PREFERENCE = ["approved_pool", "same_stake", "nobody"] as const satisfies
  readonly ContactRequestPreference[];

/**
 * Push tokens. Nullable on purpose: a client that logs out or loses its
 * registration needs a way to clear the token. The old `COALESCE` update could
 * only ever set one, so a stale token kept receiving another account's
 * notifications on that device.
 */
export const notificationSettingsSchema = z
  .strictObject({
    fcm_token: z.string().trim().max(4096).nullish(),
    apns_token: z.string().trim().max(4096).nullish(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "No notification settings provided",
  });

export const privacySettingsSchema = z
  .strictObject({
    stealth_status_view: z.boolean().optional(),
    status_visibility_default: z.enum(STATUS_VISIBILITY).optional(),
    is_single: z.boolean().optional(),
    contact_request_preference: z.enum(CONTACT_REQUEST_PREFERENCE).optional(),
    directory_visible: z.boolean().optional(),
    profile_hidden: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "No privacy settings provided",
  });

/**
 * The whitelist of self-editable profile fields, identical to the one on
 * PATCH /users/me. `strictObject` rejects unknown keys, so an attempt to smuggle
 * `role`, `is_approved`, `status`, `stake_id`, `district_id` or `mission_id`
 * through this endpoint is a 400 rather than a silent no-op.
 */
export const profileSettingsSchema = z
  .strictObject({
    full_name: fullName.optional(),
    email: email.nullish(),
    bio: bio.nullish(),
    profile_photo_url: mediaUrl.nullish(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "No profile fields provided",
  });

export type NotificationSettingsInput = z.infer<typeof notificationSettingsSchema>;
export type PrivacySettingsInput = z.infer<typeof privacySettingsSchema>;
export type ProfileSettingsInput = z.infer<typeof profileSettingsSchema>;
