import { Router } from "express";

import { authenticate, requireActive, requireApproved, requireUser } from "../../middleware/auth";
import { handle, withBody, withParams } from "../../middleware/validate";
import {
  addCoHostSchema,
  createMeetingSchema,
  joinMeetingSchema,
  meetingCodeParamsSchema,
  meetingIdParamsSchema,
  meetingUserParamsSchema,
  muteSchema,
  parseOrThrow,
  promoteSchema,
} from "./schemas";
import {
  addCoHost,
  approveJoinRequest,
  createMeeting,
  endMeeting,
  joinMeeting,
  leaveMeeting,
  meetingDetail,
  meetingParticipants,
  myActiveMeetings,
  previewByCode,
  promoteParticipant,
  rejectJoinRequest,
  setParticipantMuted,
  transferHost,
} from "./service";

export const meetingsRouter = Router();

meetingsRouter.use(authenticate, requireApproved, requireActive);

meetingsRouter.post(
  "/",
  withBody(createMeetingSchema, async (data, req, res) => {
    res.status(201).json(await createMeeting(requireUser(req).id, data));
  }),
);

// Literal-prefixed routes are declared before "/:id" so the parameter cannot
// swallow them.
meetingsRouter.get(
  "/code/:code",
  withParams(meetingCodeParamsSchema, async (params, _req, res) => {
    res.json(await previewByCode(params.code));
  }),
);

meetingsRouter.get(
  "/my/active",
  handle(async (req, res) => {
    res.json(await myActiveMeetings(requireUser(req).id));
  }),
);

meetingsRouter.get(
  "/:id",
  withParams(meetingIdParamsSchema, async (params, req, res) => {
    res.json(await meetingDetail(requireUser(req).id, params.id));
  }),
);

meetingsRouter.get(
  "/:id/participants",
  withParams(meetingIdParamsSchema, async (params, req, res) => {
    res.json(await meetingParticipants(requireUser(req).id, params.id));
  }),
);

/**
 * Join, or knock.
 *
 * Three outcomes, distinguished in the body rather than by status code alone so
 * a client can tell "this meeting needs a key" from "the key you sent is wrong":
 *
 *   200 { status: "joined" }
 *   202 { status: "pending_approval" }
 *   403 { status: "key_required" }   — prompt for a key and retry
 *   403 { error: "Incorrect meeting key." }
 *
 * The old endpoint answered 401 for both key cases, which clients handling 401
 * globally treated as an expired session and logged the user out.
 */
meetingsRouter.post(
  "/:id/join",
  handle(async (req, res) => {
    const { id } = parseOrThrow(meetingIdParamsSchema, req.params);
    const { join_key: joinKey } = parseOrThrow(joinMeetingSchema, req.body);

    const result = await joinMeeting(requireUser(req).id, id, joinKey);

    if (result.status === "key_required") {
      res.status(403).json({ ...result, error: "A meeting key is required to join." });
      return;
    }
    res.status(result.status === "pending_approval" ? 202 : 200).json(result);
  }),
);

meetingsRouter.post(
  "/:id/approve/:userId",
  withParams(meetingUserParamsSchema, async (params, req, res) => {
    res.json(await approveJoinRequest(requireUser(req).id, params.id, params.userId));
  }),
);

meetingsRouter.post(
  "/:id/reject/:userId",
  withParams(meetingUserParamsSchema, async (params, req, res) => {
    res.json(await rejectJoinRequest(requireUser(req).id, params.id, params.userId));
  }),
);

meetingsRouter.post(
  "/:id/leave",
  withParams(meetingIdParamsSchema, async (params, req, res) => {
    res.json(await leaveMeeting(requireUser(req).id, params.id));
  }),
);

meetingsRouter.post(
  "/:id/add-cohost",
  handle(async (req, res) => {
    const { id } = parseOrThrow(meetingIdParamsSchema, req.params);
    const { user_id: userId } = parseOrThrow(addCoHostSchema, req.body);
    res.json(await addCoHost(requireUser(req).id, id, userId));
  }),
);

meetingsRouter.patch(
  "/:id/promote/:userId",
  handle(async (req, res) => {
    const params = parseOrThrow(meetingUserParamsSchema, req.params);
    const body = parseOrThrow(promoteSchema, req.body);
    res.json(await promoteParticipant(requireUser(req).id, params.id, params.userId, body));
  }),
);

meetingsRouter.patch(
  "/:id/mute/:userId",
  handle(async (req, res) => {
    const params = parseOrThrow(meetingUserParamsSchema, req.params);
    const { muted } = parseOrThrow(muteSchema, req.body ?? {});
    res.json(await setParticipantMuted(requireUser(req).id, params.id, params.userId, muted));
  }),
);

meetingsRouter.post(
  "/:id/end",
  withParams(meetingIdParamsSchema, async (params, req, res) => {
    res.json(await endMeeting(requireUser(req).id, params.id));
  }),
);

meetingsRouter.post(
  "/:id/transfer-host/:userId",
  withParams(meetingUserParamsSchema, async (params, req, res) => {
    res.json(await transferHost(requireUser(req).id, params.id, params.userId));
  }),
);
