import { Router, type Request } from "express";

import { authenticate, requireApproved, requireUser } from "../../middleware/auth";
import { badRequest } from "../../middleware/errorHandler";
import { withBody, withParams } from "../../middleware/validate";
import { addReactionSchema, reactionMessageParams, reactionParams } from "./schemas";
import { addReaction, listReactions, removeReaction } from "./service";

/**
 * Mounted at `/messages/:id/reactions`, so `mergeParams` is required to see the
 * message id from the parent path.
 */
export const reactionsRouter = Router({ mergeParams: true });

reactionsRouter.use(authenticate, requireApproved);

/** Narrows the parent path id where `withBody` has already claimed the handler. */
function messageIdOf(req: Request): string {
  const parsed = reactionMessageParams.safeParse(req.params);
  if (!parsed.success) throw badRequest("A valid message id is required");
  return parsed.data.id;
}

reactionsRouter.get(
  "/",
  withParams(reactionMessageParams, async (params, req, res) => {
    res.json(await listReactions(params.id, requireUser(req).id));
  }),
);

reactionsRouter.post(
  "/",
  withBody(addReactionSchema, async (data, req, res) => {
    res.json(await addReaction(messageIdOf(req), requireUser(req).id, data.emoji));
  }),
);

reactionsRouter.delete(
  "/:emoji",
  withParams(reactionParams, async (params, req, res) => {
    res.json(await removeReaction(params.id, requireUser(req).id, params.emoji));
  }),
);
