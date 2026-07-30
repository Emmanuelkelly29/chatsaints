import { z, type ZodType } from "zod";

import { badRequest } from "../../middleware/errorHandler";

/**
 * Parses one part of a request that `withBody` / `withParams` cannot cover on
 * its own, for routes that carry both a path parameter and a body. Those go
 * through `handle` and validate each part explicitly.
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
 * Call request validation.
 *
 * The old routes read `participantIds`, `type` and `status` straight off the
 * body. `type` defaulted to the string 'voice' with no check against the enum,
 * and `status` was compared against a hand-maintained array that had already
 * drifted from the database's CHECK constraint.
 */

export const callHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const initiateCallSchema = z.object({
  // A call fans out a push notification per participant, so the ceiling is a
  // rate-limit concern as much as a product one.
  participantIds: z.array(z.string().uuid()).min(1).max(64),
  type: z.enum(["voice", "video"]).default("voice"),
  conversationId: z.string().uuid().optional(),
});

export const callIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const callStatusSchema = z.object({
  status: z.enum(["initiated", "answered", "declined", "missed", "ended"]),
});

export type CallHistoryQuery = z.infer<typeof callHistoryQuerySchema>;
export type InitiateCallInput = z.infer<typeof initiateCallSchema>;
export type CallStatusInput = z.infer<typeof callStatusSchema>;
