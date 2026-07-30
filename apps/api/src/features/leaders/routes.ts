import { Router, type Request } from "express";

import {
  authenticate,
  requireActive,
  requireApproved,
  requireRole,
  requireUser,
} from "../../middleware/auth";
import { badRequest } from "../../middleware/errorHandler";
import { withBody, withParams, withQuery } from "../../middleware/validate";
import {
  approvalListQuerySchema,
  approvalParamsSchema,
  poolMemberParamsSchema,
  rejectApprovalSchema,
} from "./schemas";
import {
  approveApplication,
  approvePoolMember,
  listPendingApprovals,
  rejectApplication,
} from "./service";

export const leadersRouter = Router();

// Reviewing applications is a privilege of an approved, active leader. The
// per-role and per-unit rules live in the service, because they depend on the
// application being reviewed.
leadersRouter.use(authenticate, requireActive, requireApproved);

/** Validates the approval id for a handler that also validates a body. */
function approvalIdOf(req: Request): string {
  const parsed = approvalParamsSchema.safeParse(req.params);
  if (!parsed.success) throw badRequest("A valid approval id is required");
  return parsed.data.id;
}

leadersRouter.get(
  "/approvals",
  withQuery(approvalListQuerySchema, async (query, req, res) => {
    res.json(await listPendingApprovals(requireUser(req), query));
  }),
);

leadersRouter.post(
  "/approvals/:id/approve",
  withParams(approvalParamsSchema, async (params, req, res) => {
    res.json(await approveApplication(requireUser(req), params.id));
  }),
);

leadersRouter.post(
  "/approvals/:id/reject",
  withBody(rejectApprovalSchema, async (data, req, res) => {
    res.json(await rejectApplication(requireUser(req), approvalIdOf(req), data));
  }),
);

/**
 * Pool approval stays on the explicit role allowlist the old handler used, with
 * the enum values spelled correctly. A tier floor would also admit
 * `ysa_adviser` and `ysa_couple_adviser`, which were never granted this.
 */
leadersRouter.post(
  "/stake-pool/approve/:userId",
  requireRole("ysa_rep", "bishop", "stake_presidency", "it_support"),
  withParams(poolMemberParamsSchema, async (params, req, res) => {
    res.json(await approvePoolMember(requireUser(req), params.userId));
  }),
);
