import { Router } from "express";

import { authenticate, requireApproved, requireUser } from "../../middleware/auth";
import { handle, withBody, withParams, withQuery } from "../../middleware/validate";
import { searchQuerySchema, updateMeSchema, userIdParamSchema } from "./schemas";
import { getMyProfile, getStakePool, getUserProfile, searchUsers, updateMyProfile } from "./service";

export const usersRouter = Router();

/**
 * Every route below requires a session. Applied once at the top rather than
 * per-route so a route added later cannot be published unauthenticated by
 * forgetting a line.
 */
usersRouter.use(authenticate);

usersRouter.get(
  "/me",
  handle(async (req, res) => {
    res.json(await getMyProfile(requireUser(req).id));
  }),
);

/**
 * Self-service profile edit. The schema is the authorization boundary here: it
 * accepts four fields and rejects everything else, so `role`, `is_approved`,
 * `status`, `stake_id`, `district_id` and `mission_id` cannot be reached from
 * this route at all.
 */
usersRouter.patch(
  "/me",
  withBody(updateMeSchema, async (data, req, res) => {
    res.json(await updateMyProfile(requireUser(req).id, data));
  }),
);

usersRouter.get(
  "/search",
  requireApproved,
  withQuery(searchQuerySchema, async (query, req, res) => {
    res.json(await searchUsers(requireUser(req), query));
  }),
);

usersRouter.get(
  "/stake-pool",
  requireApproved,
  handle(async (req, res) => {
    res.json(await getStakePool(requireUser(req)));
  }),
);

/**
 * Registered last on purpose. `/:id` would otherwise swallow `/me`, `/search`
 * and `/stake-pool`. The uuid check in the schema is the second line of defence
 * for that, and rejects a malformed id before it reaches the database.
 */
usersRouter.get(
  "/:id",
  requireApproved,
  withParams(userIdParamSchema, async (params, req, res) => {
    res.json(await getUserProfile(requireUser(req), params.id));
  }),
);
