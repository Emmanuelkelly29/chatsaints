import { Router } from "express";
import rateLimit from "express-rate-limit";

import { isTest } from "../../config/env";
import {
  authenticate,
  requireActive,
  requireApproved,
  requireUser,
} from "../../middleware/auth";
import { handle, withBody, withParams } from "../../middleware/validate";
import { contactRequestParams, createContactRequestBody } from "./schemas";
import {
  acceptContactRequest,
  createContactRequest,
  declineContactRequest,
  listContactRequests,
} from "./service";

const noop = (_req: unknown, _res: unknown, next: () => void) => {
  next();
};

/**
 * Sending requests is rate limited per caller.
 *
 * A request lands in someone's inbox and can carry a 500-character message, so
 * it is a delivery channel to a stranger. The old route had only the global
 * 600-per-15-minutes budget in front of it.
 */
const sendLimiter = isTest
  ? noop
  : rateLimit({
      windowMs: 60 * 60 * 1000,
      limit: 30,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      message: { error: "Too many connection requests. Please try again later." },
    });

export const contactRequestsRouter = Router();

/**
 * `requireActive` is new. Verifying an email sets `status` to `active`, but an
 * account that has not yet verified sits at `pending_approval` with
 * `isApproved` already true for plain members, so `requireApproved` alone let
 * unverified accounts send requests.
 */
contactRequestsRouter.use(authenticate, requireActive, requireApproved);

contactRequestsRouter.get(
  "/",
  handle(async (req, res) => {
    res.json(await listContactRequests(requireUser(req)));
  }),
);

contactRequestsRouter.post(
  "/",
  sendLimiter,
  withBody(createContactRequestBody, async (body, req, res) => {
    const result = await createContactRequest(requireUser(req), body);
    const status = result.status === "pending" ? 201 : result.status === "connected" ? 200 : 409;
    res.status(status).json(result);
  }),
);

contactRequestsRouter.post(
  "/:id/accept",
  withParams(contactRequestParams, async (params, req, res) => {
    const conversation = await acceptContactRequest(requireUser(req), params.id);
    res.json({ message: "Connection accepted", conversation });
  }),
);

contactRequestsRouter.post(
  "/:id/decline",
  withParams(contactRequestParams, async (params, req, res) => {
    await declineContactRequest(requireUser(req), params.id);
    res.json({ message: "Connection request declined" });
  }),
);
