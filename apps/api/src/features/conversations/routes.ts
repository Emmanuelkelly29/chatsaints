import { Router, type Request, type Response } from "express";

import { authenticate, requireApproved, requireUser } from "../../middleware/auth";
import { badRequest } from "../../middleware/errorHandler";
import { handle, withBody, withParams, withQuery } from "../../middleware/validate";
import {
  conversationParams,
  createConversationSchema,
  messageListQuery,
  startDirectSchema,
} from "./schemas";
import {
  createConversation,
  listConversationMessages,
  listConversations,
  listPinnedConversations,
  pinConversation,
  startDirectConversation,
  unpinConversation,
  type StartDirectResult,
} from "./service";

export const conversationsRouter = Router();

// Every conversation route requires an approved account, as before. `authenticate`
// already rejects suspended accounts.
conversationsRouter.use(authenticate, requireApproved);

/**
 * The path id needs narrowing on the routes where `withQuery` or `withBody` has
 * already claimed the handler. Kept local rather than added to the validate
 * middleware, which is shared.
 */
function conversationIdOf(req: Request): string {
  const parsed = conversationParams.safeParse(req.params);
  if (!parsed.success) throw badRequest("A valid conversation id is required");
  return parsed.data.id;
}

/**
 * A direct conversation may be blocked by the contact-request gate. That is not
 * an error condition the client can act on from a message alone, so the state of
 * the request is part of the body.
 */
function respondToDirectResult(res: Response, result: StartDirectResult): void {
  if (result.kind === "blocked") {
    res.status(403).json({
      error: result.message,
      requiresRequest: result.requiresRequest,
      requestStatus: result.requestStatus,
      requestId: result.requestId,
    });
    return;
  }
  res
    .status(result.created ? 201 : 200)
    .json({ ...result.conversation, created: result.created });
}

conversationsRouter.get(
  "/",
  handle(async (req, res) => {
    res.json({ data: await listConversations(requireUser(req).id) });
  }),
);

conversationsRouter.post(
  "/",
  withBody(createConversationSchema, async (data, req, res) => {
    const result = await createConversation(requireUser(req), data);
    if (result.kind === "group") {
      res.status(201).json(result.group);
      return;
    }
    respondToDirectResult(res, result);
  }),
);

conversationsRouter.post(
  "/1on1",
  withBody(startDirectSchema, async (data, req, res) => {
    respondToDirectResult(res, await startDirectConversation(requireUser(req), data.target_user_id));
  }),
);

conversationsRouter.get(
  "/pinned",
  handle(async (req, res) => {
    res.json({ data: await listPinnedConversations(requireUser(req).id) });
  }),
);

conversationsRouter.get(
  "/:id/messages",
  withQuery(messageListQuery, async (query, req, res) => {
    const conversationId = conversationIdOf(req);
    const messages = await listConversationMessages(conversationId, requireUser(req).id, query);
    res.json({ data: messages });
  }),
);

conversationsRouter.post(
  "/:id/pin",
  withParams(conversationParams, async (params, req, res) => {
    res.json(await pinConversation(params.id, requireUser(req).id));
  }),
);

conversationsRouter.delete(
  "/:id/pin",
  withParams(conversationParams, async (params, req, res) => {
    res.json(await unpinConversation(params.id, requireUser(req).id));
  }),
);
