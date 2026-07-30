import { z, type ZodType } from "zod";

import { badRequest } from "../../middleware/errorHandler";
import { normalizeText } from "../../lib/normalize";

/**
 * Meeting request validation.
 *
 * The old router validated by hand and inconsistently: `title` was checked for
 * truthiness, `max_participants` was range-checked but never type-checked (so
 * `"5"` passed and `{}` did not), `role` was compared against a local array, and
 * `co_host_ids` was iterated without confirming the ids were ids.
 */

/**
 * Parses one part of a request for routes that carry both a path parameter and a
 * body, where `withBody` and `withParams` cannot each own the whole request.
 * Those routes use `handle` and validate each part explicitly.
 */
export function parseOrThrow<S extends ZodType>(schema: S, value: unknown): z.infer<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw badRequest(
      parsed.error.issues
        .map((issue) => {
          const path = issue.path.join(".");
          return path ? `${path}: ${issue.message}` : issue.message;
        })
        .join("; "),
    );
  }
  return parsed.data;
}

/**
 * bcrypt hashes at most 72 bytes and silently ignores the rest, so a longer key
 * would appear to be accepted while only its first 72 bytes mattered. Reject
 * instead of truncating.
 */
const joinKey = z
  .string()
  .min(4, "A meeting key must be at least 4 characters")
  .max(72, "A meeting key must be at most 72 characters");

/**
 * Meeting codes are displayed as "123-456-789". Accepting the digits in any
 * grouping and normalizing here means a user who types or pastes "123456789"
 * is not told their code is invalid.
 */
const meetingCode = z
  .string()
  .trim()
  .transform((value) => value.replace(/\D/g, ""))
  .refine((digits) => digits.length === 9, { message: "A meeting code is 9 digits" })
  .transform((digits) => `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)}`);

export const createMeetingSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200).transform(normalizeText),
  description: z.string().trim().max(2000).transform(normalizeText).optional(),
  join_key: joinKey.optional(),
  requires_approval: z.boolean().default(false),
  allow_link_join: z.boolean().default(true),
  max_participants: z.coerce.number().int().min(2).max(1000).default(1000),
  co_host_ids: z.array(z.string().uuid()).max(50).default([]),
});

export const joinMeetingSchema = z.object({
  join_key: z.string().min(1).max(72).optional(),
});

export const addCoHostSchema = z.object({
  user_id: z.string().uuid(),
});

export const promoteSchema = z.object({
  // `host` is deliberately absent: transferring the host role is its own
  // endpoint, because it has to move the role off the current host too.
  role: z.enum(["co_host", "presenter", "attendee"]),
});

/**
 * Muting takes an explicit flag, defaulting to true.
 *
 * The old endpoint only ever set `is_muted = TRUE`, with no way back, so a host
 * who muted someone had muted them for the rest of the meeting.
 */
export const muteSchema = z.object({
  muted: z.boolean().default(true),
});

export const meetingIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const meetingUserParamsSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
});

export const meetingCodeParamsSchema = z.object({
  code: meetingCode,
});

export type CreateMeetingInput = z.infer<typeof createMeetingSchema>;
export type JoinMeetingInput = z.infer<typeof joinMeetingSchema>;
export type PromoteInput = z.infer<typeof promoteSchema>;
