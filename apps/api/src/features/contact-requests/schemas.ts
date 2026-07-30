import { z } from "zod";

import { normalizeText } from "../../lib/normalize";

/**
 * Request validation for contact requests.
 *
 * The old controller read `target_user_id` and `intro_message` straight off the
 * body, checked only that the id was truthy, and passed it into a query. Body
 * key names are kept as they were so existing clients keep working.
 */

export const createContactRequestBody = z.object({
  target_user_id: z.string().uuid("A valid user id is required"),
  intro_message: z
    .string()
    .trim()
    .max(500, "An introduction can be at most 500 characters")
    .transform(normalizeText)
    .optional()
    .transform((value) => (value ? value : null)),
});

export const contactRequestParams = z.object({
  id: z.string().uuid("A valid request id is required"),
});

export type CreateContactRequestInput = z.infer<typeof createContactRequestBody>;
