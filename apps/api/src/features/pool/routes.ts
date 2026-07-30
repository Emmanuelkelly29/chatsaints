import { Router } from "express";

import { TIER } from "../../domain/roles";
import {
  authenticate,
  requireActive,
  requireApproved,
  requireTier,
  requireUser,
} from "../../middleware/auth";
import { handle, withBody, withParams, withQuery } from "../../middleware/validate";
import {
  addMemberBody,
  directoryQuery,
  discoverQuery,
  districtIdParams,
  idParams,
  membersQuery,
  missionIdParams,
  parseUnitPath,
  stakeIdParams,
  toggleAllBody,
  unitIdParams,
  unitLocationBody,
  unitPathParams,
} from "./schemas";
import { assertCanBrowsePool } from "./scope";
import {
  addPoolMember,
  approvePoolMember,
  bulkSetPoolActive,
  deleteUnit,
  directoryUnits,
  discoverPool,
  leaderDirectory,
  leaderMembers,
  missionDirectory,
  missionMembers,
  myPoolStatus,
  myUnitPool,
  openPoolUnits,
  poolAdminView,
  removePoolMember,
  requestPoolMembership,
  setPoolActive,
  unitPoolMembers,
  updateUnitLocation,
} from "./service";

/**
 * YSA pool routes.
 *
 * Every route requires an approved, active account. That matters more than it
 * looks: verifying an email sets `status` to `active` regardless of approval, so
 * a self-claimed `stake_presidency` awaiting review would otherwise pass
 * `requireActive` and reach every leader endpoint below. The old router used
 * `authenticate` and `requireActive` only.
 *
 * `requireTier` replaces the hand-written tier comparisons. Ownership of the
 * target unit is then proved in the service layer, because a tier check alone
 * says nothing about which unit the caller may touch.
 */
export const poolRouter = Router();

poolRouter.use(authenticate, requireActive, requireApproved);

/** Any leader, from a YSA rep upward. Scope is enforced per unit afterwards. */
const leaderOnly = requireTier(TIER.wardLeader);

/**
 * Presiding leadership over a unit. District presidents sit at tier 3, so the
 * route-level floor is 3 and `canSetPoolVisibility` applies the exact rule.
 */
const presidingOnly = requireTier(TIER.bishop);

/** Area leadership and IT support, matching the old `hasGlobalPoolControl`. */
const globalOnly = requireTier(TIER.area);

// ─── Leader administration ──────────────────────────────────────────────────

poolRouter.get(
  "/members",
  leaderOnly,
  withQuery(membersQuery, async (query, req, res) => {
    res.json(await poolAdminView(requireUser(req), query.includeMembers !== "false"));
  }),
);

poolRouter.post(
  "/members/:id/approve",
  leaderOnly,
  withParams(idParams, async (params, req, res) => {
    const membership = await approvePoolMember(requireUser(req), params.id);
    res.json({ message: "Member approved", membership });
  }),
);

poolRouter.post(
  "/members/:id/remove",
  leaderOnly,
  withParams(idParams, async (params, req, res) => {
    await removePoolMember(requireUser(req), params.id);
    res.json({ message: "Member removed" });
  }),
);

poolRouter.post(
  "/add",
  leaderOnly,
  withBody(addMemberBody, async (body, req, res) => {
    const result = await addPoolMember(requireUser(req), body);
    res.status(result.created ? 201 : 200).json({
      message: result.created ? "Member added to the pool" : "Member is already in the pool",
      membership: result.membership,
    });
  }),
);

// ─── Pool visibility ────────────────────────────────────────────────────────

poolRouter.post(
  "/toggle/:stakeId",
  presidingOnly,
  withParams(stakeIdParams, async (params, req, res) => {
    const result = await setPoolActive(
      requireUser(req),
      { type: "stake", id: params.stakeId },
      null,
    );
    res.json({ active: result.active, unit: result });
  }),
);

poolRouter.post(
  "/toggle-district/:districtId",
  presidingOnly,
  withParams(districtIdParams, async (params, req, res) => {
    const result = await setPoolActive(
      requireUser(req),
      { type: "district", id: params.districtId },
      null,
    );
    res.json({ active: result.active, unit: result });
  }),
);

poolRouter.post(
  "/open/:stakeId",
  presidingOnly,
  withParams(stakeIdParams, async (params, req, res) => {
    const result = await setPoolActive(
      requireUser(req),
      { type: "stake", id: params.stakeId },
      true,
    );
    res.json({ active: result.active, unit: result });
  }),
);

poolRouter.post(
  "/toggle-all",
  presidingOnly,
  withBody(toggleAllBody, async (body, req, res) => {
    const result = await bulkSetPoolActive(requireUser(req), body);
    res.json({
      message: `Pool status set to ${result.active ? "ON" : "OFF"}`,
      ...result,
    });
  }),
);

// ─── Unit administration ────────────────────────────────────────────────────

poolRouter.patch(
  "/units/:unitType/:id/location",
  globalOnly,
  withBody(unitLocationBody, async (body, req, res) => {
    const { unitType, id } = parseUnitPath(req.params);
    const unit = await updateUnitLocation(requireUser(req), unitType, id, body);
    res.json({ message: `${unitType} location updated`, unit });
  }),
);

poolRouter.delete(
  "/units/:unitType/:id",
  globalOnly,
  withParams(unitPathParams, async (params, req, res) => {
    const unit = await deleteUnit(requireUser(req), params.unitType, params.id);
    res.json({ message: `${params.unitType} deleted`, unit });
  }),
);

// ─── Member self-service ────────────────────────────────────────────────────

poolRouter.get(
  "/my-status",
  handle(async (req, res) => {
    const user = requireUser(req);
    assertCanBrowsePool(user);
    res.json(await myPoolStatus(user));
  }),
);

poolRouter.post(
  "/request",
  handle(async (req, res) => {
    const user = requireUser(req);
    assertCanBrowsePool(user);
    const result = await requestPoolMembership(user);
    res.status(201).json({ message: "Request submitted. Awaiting leader approval.", ...result });
  }),
);

poolRouter.get(
  "/my-stake",
  handle(async (req, res) => {
    const user = requireUser(req);
    assertCanBrowsePool(user);
    res.json(await myUnitPool(user));
  }),
);

// ─── Discovery ──────────────────────────────────────────────────────────────

poolRouter.get(
  "/discover",
  withQuery(discoverQuery, async (query, req, res) => {
    const user = requireUser(req);
    assertCanBrowsePool(user);
    const contacts = await discoverPool(user, {
      ageRanges: query.age_ranges,
      gender: query.gender,
      limit: query.limit,
    });
    res.json({ contacts });
  }),
);

/**
 * Kept as an alias of `/discover`.
 *
 * Its comment claimed it existed so missionaries could browse the worldwide
 * pool, which is exactly what `canAccessStakePool` and `canViewProfile` both
 * forbid: a serving missionary cannot see a YSA member's profile. It returned
 * the same rows as `/discover` with no gate at all. Missionaries use
 * `/missionary-directory`.
 */
poolRouter.get(
  "/global",
  withQuery(discoverQuery, async (query, req, res) => {
    const user = requireUser(req);
    assertCanBrowsePool(user);
    const contacts = await discoverPool(user, {
      ageRanges: query.age_ranges,
      gender: query.gender,
      limit: query.limit,
    });
    res.json({ contacts });
  }),
);

poolRouter.get(
  "/directory-stakes",
  withQuery(directoryQuery, async (query, req, res) => {
    const user = requireUser(req);
    assertCanBrowsePool(user);
    const stakes = await directoryUnits(user, {
      ageRanges: query.age_ranges,
      gender: query.gender,
    });
    res.json({ stakes });
  }),
);

poolRouter.get(
  "/stakes-list",
  handle(async (req, res) => {
    const user = requireUser(req);
    assertCanBrowsePool(user);
    res.json({ stakes: await openPoolUnits(user) });
  }),
);

/** Path parameter is still named `stakeId`; it may name a stake or a district. */
poolRouter.get(
  "/stake-members/:stakeId",
  withParams(stakeIdParams, async (params, req, res) => {
    const user = requireUser(req);
    assertCanBrowsePool(user);
    const result = await unitPoolMembers(user, params.stakeId);
    res.json({ unit: result.unit, members: result.members });
  }),
);

// ─── Leader directory ───────────────────────────────────────────────────────

poolRouter.get(
  "/leader-directory",
  handle(async (req, res) => {
    const user = requireUser(req);
    assertCanBrowsePool(user);
    res.json({ stakes: await leaderDirectory(user) });
  }),
);

poolRouter.get(
  "/leader-members/:unitId",
  withParams(unitIdParams, async (params, req, res) => {
    const user = requireUser(req);
    assertCanBrowsePool(user);
    res.json({ members: await leaderMembers(user, params.unitId) });
  }),
);

// ─── Mission directory ──────────────────────────────────────────────────────

poolRouter.get(
  "/missionary-directory",
  handle(async (req, res) => {
    res.json({ stakes: await missionDirectory(requireUser(req)) });
  }),
);

poolRouter.get(
  "/missionary-mission-members/:missionId",
  withParams(missionIdParams, async (params, req, res) => {
    res.json({ members: await missionMembers(requireUser(req), params.missionId) });
  }),
);
