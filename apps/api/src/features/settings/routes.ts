import { Router } from "express";

import { authenticate, requireApproved, requireUser } from "../../middleware/auth";
import { handle, withBody } from "../../middleware/validate";
import {
  notificationSettingsSchema,
  privacySettingsSchema,
  profileSettingsSchema,
} from "./schemas";
import {
  deleteAccount,
  getSettings,
  updateNotificationSettings,
  updatePrivacySettings,
  updateProfileSettings,
} from "./service";

export const settingsRouter = Router();

/**
 * Every route below acts on the caller's own account only. The user id comes
 * from the verified token, never from the path or the body, so there is no
 * object reference for a caller to tamper with.
 */
settingsRouter.use(authenticate);

settingsRouter.get(
  "/",
  handle(async (req, res) => {
    res.json(await getSettings(requireUser(req).id));
  }),
);

settingsRouter.patch(
  "/notifications",
  withBody(notificationSettingsSchema, async (data, req, res) => {
    res.json(await updateNotificationSettings(requireUser(req).id, data));
  }),
);

settingsRouter.patch(
  "/privacy",
  requireApproved,
  withBody(privacySettingsSchema, async (data, req, res) => {
    res.json(await updatePrivacySettings(requireUser(req).id, data));
  }),
);

settingsRouter.patch(
  "/profile",
  withBody(profileSettingsSchema, async (data, req, res) => {
    res.json(await updateProfileSettings(requireUser(req).id, data));
  }),
);

/**
 * Irreversible. Takes no body: the account acted on is the one the token
 * belongs to, and there is nothing to whitelist.
 */
settingsRouter.delete(
  "/account",
  handle(async (req, res) => {
    res.json(await deleteAccount(requireUser(req)));
  }),
);
