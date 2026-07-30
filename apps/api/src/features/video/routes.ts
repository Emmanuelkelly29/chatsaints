import { Router } from "express";

import { authenticate, requireActive, requireApproved, requireUser } from "../../middleware/auth";
import { withBody, withParams } from "../../middleware/validate";
import { conversationIdParamsSchema, createRoomSchema, roomIdParamsSchema } from "./schemas";
import { activeRoom, createOrJoinRoom, leaveRoom } from "./service";

export const videoRouter = Router();

/** `requireApproved` matches the old router; `requireActive` is added. */
videoRouter.use(authenticate, requireApproved, requireActive);

videoRouter.post(
  "/rooms",
  withBody(createRoomSchema, async (data, req, res) => {
    res.json(await createOrJoinRoom(requireUser(req), data));
  }),
);

videoRouter.post(
  "/rooms/:roomId/leave",
  withParams(roomIdParamsSchema, async (params, req, res) => {
    res.json(await leaveRoom(requireUser(req).id, params.roomId));
  }),
);

videoRouter.get(
  "/rooms/:conversationId/active",
  withParams(conversationIdParamsSchema, async (params, req, res) => {
    res.json(await activeRoom(requireUser(req).id, params.conversationId));
  }),
);
