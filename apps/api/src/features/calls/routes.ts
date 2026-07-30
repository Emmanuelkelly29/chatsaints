import { Router } from "express";

import { authenticate, requireActive, requireUser } from "../../middleware/auth";
import { handle, withBody, withQuery } from "../../middleware/validate";
import {
  callHistoryQuerySchema,
  callIdParamsSchema,
  callStatusSchema,
  initiateCallSchema,
  parseOrThrow,
} from "./schemas";
import { callHistory, initiateCall, updateCallStatus } from "./service";

/**
 * Calling requires an active account, matching the old router. Deliberately not
 * `requireApproved`: a leader whose claimed role is still awaiting approval is
 * an ordinary member in the meantime, and ordinary members can call people.
 */
export const callsRouter = Router();

callsRouter.get(
  "/history",
  authenticate,
  requireActive,
  withQuery(callHistoryQuerySchema, async (query, req, res) => {
    res.json(await callHistory(requireUser(req).id, query));
  }),
);

callsRouter.post(
  "/initiate",
  authenticate,
  requireActive,
  withBody(initiateCallSchema, async (data, req, res) => {
    res.status(201).json(await initiateCall(requireUser(req).id, data));
  }),
);

/**
 * Status transitions require `authenticate` only, so that an account which loses
 * its standing mid-call can still hang up. Authorization here is participation
 * in the specific call, which the service enforces.
 */
callsRouter.patch(
  "/:id/status",
  authenticate,
  handle(async (req, res) => {
    const { id } = parseOrThrow(callIdParamsSchema, req.params);
    const { status } = parseOrThrow(callStatusSchema, req.body);
    res.json(await updateCallStatus(requireUser(req).id, id, status));
  }),
);
