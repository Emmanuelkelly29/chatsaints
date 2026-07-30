import { Router, type Request } from "express";

import { authenticate, requireApproved, requireUser } from "../../middleware/auth";
import { badRequest } from "../../middleware/errorHandler";
import { withBody, withParams } from "../../middleware/validate";
import {
  addMembersSchema,
  createGroupSchema,
  groupMemberParams,
  groupParams,
  toggleAdminSchema,
  updateGroupSchema,
} from "./schemas";
import {
  addMembers,
  createGroup,
  getGroupInfo,
  removeMember,
  setMemberAdmin,
  updateGroup,
} from "./service";

export const groupsRouter = Router();

groupsRouter.use(authenticate, requireApproved);

/** Narrows the path ids where `withBody` has already claimed the handler. */
function groupIdOf(req: Request): string {
  const parsed = groupParams.safeParse(req.params);
  if (!parsed.success) throw badRequest("A valid group id is required");
  return parsed.data.id;
}

function memberPathOf(req: Request): { id: string; userId: string } {
  const parsed = groupMemberParams.safeParse(req.params);
  if (!parsed.success) throw badRequest("A valid group id and member id are required");
  return parsed.data;
}

groupsRouter.post(
  "/",
  withBody(createGroupSchema, async (data, req, res) => {
    res.status(201).json(await createGroup(requireUser(req), data));
  }),
);

groupsRouter.get(
  "/:id",
  withParams(groupParams, async (params, req, res) => {
    res.json(await getGroupInfo(params.id, requireUser(req).id));
  }),
);

groupsRouter.patch(
  "/:id",
  withBody(updateGroupSchema, async (data, req, res) => {
    res.json(await updateGroup(groupIdOf(req), requireUser(req).id, data));
  }),
);

groupsRouter.post(
  "/:id/members",
  withBody(addMembersSchema, async (data, req, res) => {
    res.json(await addMembers(requireUser(req), groupIdOf(req), data.member_ids));
  }),
);

groupsRouter.delete(
  "/:id/members/:userId",
  withParams(groupMemberParams, async (params, req, res) => {
    res.json(await removeMember(params.id, requireUser(req).id, params.userId));
  }),
);

groupsRouter.patch(
  "/:id/members/:userId/admin",
  withBody(toggleAdminSchema, async (data, req, res) => {
    const path = memberPathOf(req);
    res.json(
      await setMemberAdmin(path.id, requireUser(req).id, path.userId, data.is_admin),
    );
  }),
);
