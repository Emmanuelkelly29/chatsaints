import { Router } from "express";

import { authenticate, requireUser } from "../../middleware/auth";
import { notFound } from "../../middleware/errorHandler";
import { handle, withParams, withQuery } from "../../middleware/validate";
import { listNotificationsSchema, notificationIdSchema } from "./schemas";
import { countUnread, listNotifications, markAllRead, markRead } from "./service";

/**
 * A user's own notification inbox.
 *
 * `authenticate` is the only gate, deliberately. Approval and activation are not
 * required because some of the notifications delivered here are exactly the ones
 * a pending account needs to read, such as "your leader approved your account".
 * Every query below is keyed on `requireUser(req).id`, so there is no path to
 * another account's rows.
 */
export const notificationsRouter = Router();

notificationsRouter.use(authenticate);

// GET /api/notifications
notificationsRouter.get(
  "/",
  withQuery(listNotificationsSchema, async (query, req, res) => {
    const { notifications, unreadCount } = await listNotifications(requireUser(req).id, {
      limit: query.limit,
      offset: query.offset,
      unreadOnly: query.unread,
    });
    res.json({ notifications, unreadCount });
  }),
);

// GET /api/notifications/unread-count
notificationsRouter.get(
  "/unread-count",
  handle(async (req, res) => {
    res.json({ count: await countUnread(requireUser(req).id) });
  }),
);

// PATCH /api/notifications/read-all
//
// Registered before "/:id/read" is irrelevant here (the shapes differ), but the
// announcements router shows what happens when it is not: the old code put
// PATCH /read-all after PATCH /:id and the literal route was never reachable.
notificationsRouter.patch(
  "/read-all",
  handle(async (req, res) => {
    res.json({ updated: await markAllRead(requireUser(req).id) });
  }),
);

// PATCH /api/notifications/:id/read
notificationsRouter.patch(
  "/:id/read",
  withParams(notificationIdSchema, async (params, req, res) => {
    const updated = await markRead(requireUser(req).id, params.id);
    if (!updated) throw notFound("Notification not found");
    res.json({ message: "Marked as read" });
  }),
);
