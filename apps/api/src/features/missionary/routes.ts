import { Router } from "express";

import { TIER } from "../../domain/roles";
import {
  authenticate,
  requireActive,
  requireApproved,
  requireTier,
  requireUser,
} from "../../middleware/auth";
import { handle, withBody, withParams } from "../../middleware/validate";
import {
  activateMissionarySchema,
  deactivateMissionarySchema,
  missionParamsSchema,
} from "./schemas";
import {
  activateMissionaryMode,
  deactivateMissionaryMode,
  listMissionMembers,
  listMissionPresidents,
} from "./service";

export const missionaryRouter = Router();

missionaryRouter.use(authenticate, requireActive, requireApproved);

/**
 * `requireTier(TIER.stake)` replaces `if (ROLE_TIER[req.user.role] < 4)`.
 *
 * That comparison was the guard on both of these endpoints, and it passed for
 * every role the old table omitted (`district_presidency`, `ysa_adviser`),
 * because `undefined < 4` evaluates to false. The tier table behind
 * `requireTier` is a complete `Record<LeadershipRole, number>`, so a role can no
 * longer be absent from it without breaking the build.
 *
 * The tier floor is only the first gate. Seniority over the target and a shared
 * unit are checked in the service, against the account that was actually loaded.
 */
missionaryRouter.post(
  "/activate",
  requireTier(TIER.stake),
  withBody(activateMissionarySchema, async (data, req, res) => {
    res.json(await activateMissionaryMode(requireUser(req), data));
  }),
);

missionaryRouter.post(
  "/deactivate",
  requireTier(TIER.stake),
  withBody(deactivateMissionarySchema, async (data, req, res) => {
    res.json(await deactivateMissionaryMode(requireUser(req), data));
  }),
);

// Mission presidents and their wives both sit at council tier, so this floor
// covers the old `isMissionPresident || userTier >= 5` condition exactly.
missionaryRouter.get(
  "/presidents",
  requireTier(TIER.council),
  handle(async (_req, res) => {
    res.json(await listMissionPresidents());
  }),
);

missionaryRouter.get(
  "/mission/:mission_id/members",
  withParams(missionParamsSchema, async (params, req, res) => {
    res.json(await listMissionMembers(requireUser(req), params.mission_id));
  }),
);
