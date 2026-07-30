import { Router, type Request, type RequestHandler } from "express";

import { TIER } from "../../domain/roles";
import {
  authenticate,
  requireActive,
  requireApproved,
  requireTier,
  requireUser,
} from "../../middleware/auth";
import { badRequest } from "../../middleware/errorHandler";
import { handle, withBody, withParams, withQuery } from "../../middleware/validate";
import {
  areaFilterSchema,
  createUnitSchema,
  renameUnitSchema,
  stakeFilterSchema,
  unitParamsSchema,
} from "./schemas";
import {
  deleteDistrict,
  deleteStake,
  findOrCreateDistrict,
  findOrCreateStake,
  listAreas,
  listDistricts,
  listMissions,
  listStakes,
  renameDistrict,
  renameStake,
} from "./service";

export const geographyRouter = Router();

/**
 * Validates the route parameter for handlers that also validate a body.
 * `withBody` forwards a throw to the error handler, so a bad id is a 400 rather
 * than an unhandled rejection.
 */
function unitIdOf(req: Request): string {
  const parsed = unitParamsSchema.safeParse(req.params);
  if (!parsed.success) throw badRequest("A valid unit id is required");
  return parsed.data.id;
}

/**
 * Creating a unit is a leadership action, not a public one.
 *
 * POST /geography/stakes and POST /geography/districts previously had no
 * middleware at all: any unauthenticated caller could create unlimited stakes
 * and districts, and each one then appeared in the public registration pickers.
 * Registration does not need these endpoints, because the auth service resolves
 * a leader's stake or district (find-or-create) internally as part of signing up.
 */
const unitWrite: RequestHandler[] = [
  authenticate,
  requireActive,
  // PATCH and DELETE previously ran `authenticate` and `requireRole` but never
  // `requireApproved`, so an account that had merely *claimed* a senior role at
  // registration could rename or delete any stake in the world.
  requireApproved,
  requireTier(TIER.stake),
];

/**
 * Destroying a unit detaches every member of it and removes its YSA pool. That
 * is not a stake-level action, so it sits at area authority and above. The old
 * allowlist included `stake_presidency` and `mission_president`, either of whom
 * could delete a stake on the other side of the world.
 */
const unitDelete: RequestHandler[] = [
  authenticate,
  requireActive,
  requireApproved,
  requireTier(TIER.area),
];

// ─── Public reads ───────────────────────────────────────────────────────────
// These are legitimately public: the registration screens need them before any
// token exists.

geographyRouter.get(
  "/areas",
  handle(async (_req, res) => {
    res.json(await listAreas());
  }),
);

geographyRouter.get(
  "/stakes",
  withQuery(stakeFilterSchema, async (filter, _req, res) => {
    res.json(await listStakes(filter));
  }),
);

geographyRouter.get(
  "/districts",
  withQuery(areaFilterSchema, async (filter, _req, res) => {
    res.json(await listDistricts(filter));
  }),
);

geographyRouter.get(
  "/missions",
  withQuery(areaFilterSchema, async (filter, _req, res) => {
    res.json(await listMissions(filter));
  }),
);

// ─── Stakes ─────────────────────────────────────────────────────────────────

geographyRouter.post(
  "/stakes",
  ...unitWrite,
  withBody(createUnitSchema, async (data, _req, res) => {
    const { unit, created } = await findOrCreateStake(data);
    res.status(created ? 201 : 200).json(unit);
  }),
);

geographyRouter.patch(
  "/stakes/:id",
  ...unitWrite,
  withBody(renameUnitSchema, async (data, req, res) => {
    res.json(await renameStake(unitIdOf(req), data.name, requireUser(req).id));
  }),
);

geographyRouter.delete(
  "/stakes/:id",
  ...unitDelete,
  withParams(unitParamsSchema, async (params, req, res) => {
    res.json({ message: "Deleted", deleted: await deleteStake(params.id, requireUser(req).id) });
  }),
);

// ─── Districts ──────────────────────────────────────────────────────────────

geographyRouter.post(
  "/districts",
  ...unitWrite,
  withBody(createUnitSchema, async (data, _req, res) => {
    const { unit, created } = await findOrCreateDistrict(data);
    res.status(created ? 201 : 200).json(unit);
  }),
);

geographyRouter.patch(
  "/districts/:id",
  ...unitWrite,
  withBody(renameUnitSchema, async (data, req, res) => {
    res.json(await renameDistrict(unitIdOf(req), data.name, requireUser(req).id));
  }),
);

geographyRouter.delete(
  "/districts/:id",
  ...unitDelete,
  withParams(unitParamsSchema, async (params, req, res) => {
    res.json({
      message: "Deleted",
      deleted: await deleteDistrict(params.id, requireUser(req).id),
    });
  }),
);
