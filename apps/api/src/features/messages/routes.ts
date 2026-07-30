import { Router, type Request } from "express";

import { authenticate, requireActive, requireApproved, requireUser } from "../../middleware/auth";
import { badRequest } from "../../middleware/errorHandler";
import { withParams, withQuery } from "../../middleware/validate";
import { conversationMessagesParams, messageListQuery, messageParams } from "./schemas";
import { deleteMessage, listMessages } from "./service";

export const messagesRouter = Router();

// The old router applied `requireActive` to the history endpoint and only
// `authenticate` to deletion, so a pending account could delete messages.
messagesRouter.use(authenticate, requireApproved, requireActive);

/** Narrows the path id where `withQuery` has already claimed the handler. */
function conversationIdOf(req: Request): string {
  const parsed = conversationMessagesParams.safeParse(req.params);
  if (!parsed.success) throw badRequest("A valid conversation id is required");
  return parsed.data.conversationId;
}

messagesRouter.get(
  "/:conversationId",
  withQuery(messageListQuery, async (query, req, res) => {
    const conversationId = conversationIdOf(req);
    res.json({ messages: await listMessages(conversationId, requireUser(req).id, query) });
  }),
);

messagesRouter.delete(
  "/:id",
  withParams(messageParams, async (params, req, res) => {
    res.json(await deleteMessage(params.id, requireUser(req).id));
  }),
);
