import { Router, type Request, type RequestHandler } from "express";

import { TIER } from "../../domain/roles";
import type { LeadershipRole } from "../../generated/prisma/enums";
import {
  authenticate,
  requireActive,
  requireApproved,
  requireTier,
  requireUser,
} from "../../middleware/auth";
import { badRequest, forbidden } from "../../middleware/errorHandler";
import { handle, withBody, withQuery } from "../../middleware/validate";
import {
  stakeListQuerySchema,
  suspendUserSchema,
  userListQuerySchema,
  userParamsSchema,
} from "./schemas";
import {
  getDashboard,
  getMissionaryOverview,
  getStakesOverview,
  listUsers,
  suspendUser,
} from "./service";

export const adminRouter = Router();

/**
 * Roles that have their own surfaces and are deliberately kept out of the admin
 * dashboard, carried over from the old router.
 */
const RESTRICTED_ADMIN_ROLES: ReadonlySet<LeadershipRole> = new Set<LeadershipRole>([
  "stake_presidency",
  "mission_president",
  "mission_president_wife",
]);

const blockRestrictedAdminRoles: RequestHandler = (req, _res, next) => {
  const user = requireUser(req);
  if (RESTRICTED_ADMIN_ROLES.has(user.role)) {
    next(forbidden("Admin access is not available for this role"));
    return;
  }
  next();
};

/**
 * Every admin route: authenticated, active, approved, and a bishop tier floor.
 *
 * The old router gated on `requireRole('BISHOP', 'STAKE_PRESIDENT',
 * 'DISTRICT_PRESIDENT', 'COORDINATING_COUNCIL_LEADER', 'AREA_AUTHORITY', ...)`.
 * Not one of those strings exists in the `leadership_role` enum, whose values are
 * `bishop`, `stake_presidency`, `district_presidency` and
 * `coordinating_council`. Since the old `requireRole` also opened with a blanket
 * `if (role === 'it_support') return next()`, the practical effect was that
 * `/admin` was reachable by IT support alone and 403 for every real leader.
 *
 * `requireTier` replaces the allowlist so this cannot drift out of the enum
 * again: the tier table is exhaustive over `LeadershipRole` by type.
 */
adminRouter.use(
  authenticate,
  requireActive,
  requireApproved,
  blockRestrictedAdminRoles,
  requireTier(TIER.bishop),
);

/** Validates the target user id for a handler that also validates a body. */
function userIdOf(req: Request): string {
  const parsed = userParamsSchema.safeParse(req.params);
  if (!parsed.success) throw badRequest("A valid user id is required");
  return parsed.data.id;
}

adminRouter.get(
  "/dashboard",
  handle(async (req, res) => {
    res.json(await getDashboard(requireUser(req)));
  }),
);

adminRouter.get(
  "/users",
  withQuery(userListQuerySchema, async (query, req, res) => {
    res.json(await listUsers(requireUser(req), query));
  }),
);

// Suspension sits a tier above the dashboard, matching the old handler's
// "Coordinating Council or above" intent. Seniority over the target and a shared
// unit are enforced in the service, against the target that was actually loaded.
adminRouter.patch(
  "/users/:id/suspend",
  requireTier(TIER.stake),
  withBody(suspendUserSchema, async (data, req, res) => {
    res.json(await suspendUser(requireUser(req), userIdOf(req), data));
  }),
);

adminRouter.get(
  "/missionary/overview",
  handle(async (req, res) => {
    res.json(await getMissionaryOverview(requireUser(req)));
  }),
);

// `ROLE_TIER[req.user.role] < 4` was the old guard here. For any role missing
// from that table the comparison was `undefined < 4`, which is false, so the
// guard passed. `requireTier` is exhaustive over the enum.
adminRouter.get(
  "/stakes",
  requireTier(TIER.stake),
  withQuery(stakeListQuerySchema, async (query, _req, res) => {
    res.json(await getStakesOverview(query));
  }),
);
