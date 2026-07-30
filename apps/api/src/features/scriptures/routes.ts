import { Router } from "express";

import { authenticate } from "../../middleware/auth";
import { handle, withQuery } from "../../middleware/validate";
import { randomScriptureQuerySchema } from "./schemas";
import { currentScripture, randomScripture } from "./service";

/**
 * Scripture endpoints.
 *
 * Read-only and available to any authenticated account, including one still
 * pending approval: the rotating verse is part of the sign-in surface.
 */
export const scripturesRouter = Router();

scripturesRouter.get(
  "/current",
  authenticate,
  handle(async (_req, res) => {
    res.json(await currentScripture());
  }),
);

scripturesRouter.get(
  "/random",
  authenticate,
  withQuery(randomScriptureQuerySchema, async (query, _req, res) => {
    res.json(await randomScripture(query.volume));
  }),
);
