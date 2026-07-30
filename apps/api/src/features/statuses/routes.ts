import { Router, type Request } from "express";

import { authenticate, requireActive, requireApproved, requireUser } from "../../middleware/auth";
import { badRequest } from "../../middleware/errorHandler";
import { handle, withBody, withParams } from "../../middleware/validate";
import {
  createStatusSchema,
  statusIdSchema,
  statusSettingsSchema,
  viewStatusSchema,
} from "./schemas";
import {
  createStatus,
  deleteStatus,
  getFeed,
  getMyStatuses,
  getStatusViewers,
  updateStatusSettings,
  viewStatus,
} from "./service";

/**
 * 24-hour ephemeral statuses.
 *
 * The old router applied `authenticate, requireApproved` to everything.
 * `requireActive` is added here: a `pending_approval` account is one that has not
 * verified its email address, and an unverified account has no business posting
 * ephemeral media to other members or appearing in their viewer lists.
 */
export const statusesRouter = Router();

statusesRouter.use(authenticate, requireApproved, requireActive);

/** For the one route that validates both a body and a path parameter. */
function statusIdOf(req: Request): string {
  const parsed = statusIdSchema.safeParse(req.params);
  if (!parsed.success) throw badRequest("A status id must be a UUID");
  return parsed.data.id;
}

// GET /api/statuses/feed
statusesRouter.get(
  "/feed",
  handle(async (req, res) => {
    res.json(await getFeed(requireUser(req).id));
  }),
);

// GET /api/statuses/mine
statusesRouter.get(
  "/mine",
  handle(async (req, res) => {
    res.json(await getMyStatuses(requireUser(req).id));
  }),
);

// PATCH /api/statuses/settings
statusesRouter.patch(
  "/settings",
  withBody(statusSettingsSchema, async (data, req, res) => {
    res.json(await updateStatusSettings(requireUser(req).id, data));
  }),
);

// POST /api/statuses
statusesRouter.post(
  "/",
  withBody(createStatusSchema, async (data, req, res) => {
    res.status(201).json(await createStatus(requireUser(req), data));
  }),
);

// POST /api/statuses/:id/view
statusesRouter.post(
  "/:id/view",
  withBody(viewStatusSchema, async (data, req, res) => {
    res.json(await viewStatus(requireUser(req), statusIdOf(req), data.stealth));
  }),
);

// GET /api/statuses/:id/viewers
statusesRouter.get(
  "/:id/viewers",
  withParams(statusIdSchema, async (params, req, res) => {
    res.json(await getStatusViewers(requireUser(req).id, params.id));
  }),
);

// DELETE /api/statuses/:id
statusesRouter.delete(
  "/:id",
  withParams(statusIdSchema, async (params, req, res) => {
    await deleteStatus(requireUser(req).id, params.id);
    res.json({ message: "Status deleted" });
  }),
);
