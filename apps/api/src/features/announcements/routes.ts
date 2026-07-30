import { Router, type Request } from "express";

import {
  authenticate,
  requireActive,
  requireApproved,
  requireRole,
  requireUser,
} from "../../middleware/auth";
import { badRequest } from "../../middleware/errorHandler";
import { handle, withBody, withParams, withQuery } from "../../middleware/validate";
import { ANNOUNCEMENT_SENDER_ROLES } from "./audience";
import {
  announcementIdSchema,
  createAnnouncementSchema,
  editAnnouncementSchema,
  listReceivedSchema,
  listSentSchema,
} from "./schemas";
import {
  countUnread,
  createAnnouncement,
  editAnnouncement,
  listReceived,
  listSent,
  markAllRead,
  markRead,
} from "./service";

export const announcementsRouter = Router();

announcementsRouter.use(authenticate);

/** For the one route that validates both a body and a path parameter. */
function announcementIdOf(req: Request): string {
  const parsed = announcementIdSchema.safeParse(req.params);
  if (!parsed.success) throw badRequest("An announcement id must be a UUID");
  return parsed.data.id;
}

/**
 * POST /api/announcements
 *
 * SECURITY: the old route was `router.post('/', authenticate, ...)` and then
 * checked only that `req.user.role` was in a set of leader names. It never
 * checked `is_approved`. Since registration wrote the requested role straight to
 * the user row, anyone could sign up claiming `first_presidency` or `apostle`,
 * skip approval entirely, and immediately push an announcement to every account
 * on the platform. `it_support` was in the same set and was auto-approved.
 *
 * Three things close that:
 *   1. `requireApproved` - a claimed role does nothing until a senior leader
 *      grants it.
 *   2. `requireActive` - the account must be verified and in good standing.
 *   3. `requireRole(...ANNOUNCEMENT_SENDER_ROLES)` - an explicit allowlist, from
 *      which `it_support` is absent.
 *
 * Scope is then derived from the sender's role and geography inside the service.
 * It is never read from the request body, so no sender can widen their own reach.
 */
announcementsRouter.post(
  "/",
  requireApproved,
  requireActive,
  requireRole(...ANNOUNCEMENT_SENDER_ROLES),
  withBody(createAnnouncementSchema, async (data, req, res) => {
    res.status(201).json(await createAnnouncement(requireUser(req), data));
  }),
);

// GET /api/announcements - the caller's inbox.
announcementsRouter.get(
  "/",
  withQuery(listReceivedSchema, async (query, req, res) => {
    res.json(
      await listReceived(requireUser(req).id, {
        limit: query.limit,
        offset: query.offset,
        unreadOnly: query.unread,
      }),
    );
  }),
);

// GET /api/announcements/sent
announcementsRouter.get(
  "/sent",
  withQuery(listSentSchema, async (query, req, res) => {
    res.json(await listSent(requireUser(req).id, query));
  }),
);

// GET /api/announcements/unread-count
announcementsRouter.get(
  "/unread-count",
  handle(async (req, res) => {
    res.json({ count: await countUnread(requireUser(req).id) });
  }),
);

// PATCH /api/announcements/read-all
//
// This MUST stay above "/:id". The old file declared PATCH /:id first and
// PATCH /read-all eighty lines later, so Express matched /read-all as an id: the
// endpoint answered 403 "Not a leader" for ordinary members and 400
// "title or body required" for leaders, and never marked anything read.
announcementsRouter.patch(
  "/read-all",
  handle(async (req, res) => {
    res.json({ updated: await markAllRead(requireUser(req).id) });
  }),
);

// PATCH /api/announcements/:id/read
announcementsRouter.patch(
  "/:id/read",
  withParams(announcementIdSchema, async (params, req, res) => {
    await markRead(requireUser(req).id, params.id);
    res.json({ message: "Marked as read" });
  }),
);

// PATCH /api/announcements/:id - the sender edits their own announcement.
announcementsRouter.patch(
  "/:id",
  withBody(editAnnouncementSchema, async (data, req, res) => {
    const announcement = await editAnnouncement(requireUser(req).id, announcementIdOf(req), data);
    res.json({ announcement });
  }),
);
