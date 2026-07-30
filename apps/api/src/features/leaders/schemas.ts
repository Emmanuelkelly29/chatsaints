import { z } from "zod";

import { normalizeText } from "../../lib/normalize";

/** Approval review input. The old handlers read `req.params` and `req.body` raw. */

export const approvalParamsSchema = z.object({
  id: z.string().uuid("A valid approval id is required"),
});

export const poolMemberParamsSchema = z.object({
  userId: z.string().uuid("A valid user id is required"),
});

export const rejectApprovalSchema = z.object({
  notes: z.string().trim().max(1000).transform(normalizeText).optional(),
});

/** Paging so a leader with a long queue cannot pull an unbounded response. */
export const approvalListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type ApprovalListQuery = z.infer<typeof approvalListQuerySchema>;
export type RejectApprovalInput = z.infer<typeof rejectApprovalSchema>;
