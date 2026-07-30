import { Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

import { isTest } from "../../config/env";
import { authenticate, requireActive, requireUser } from "../../middleware/auth";
import { handle, withBody, withParams } from "../../middleware/validate";
import { registerKeysSchema, uploadPreKeysSchema, userIdParamsSchema } from "./schemas";
import {
  addOneTimePreKeys,
  drainQueue,
  fetchKeyBundle,
  preKeyStatus,
  registerKeyBundle,
} from "./service";

const noop = (_req: unknown, _res: unknown, next: () => void) => {
  next();
};

/**
 * Bundle fetches are budgeted per account, not per IP.
 *
 * Each successful fetch of somebody else's bundle destroys one of their one-time
 * prekeys, so this is a limit on how much damage one account can do rather than
 * an ordinary throughput limit. An IP-keyed limiter would not help: the abusive
 * pattern is one authenticated account in a loop, and rotating IPs is cheap.
 *
 * The budget still needs to cover legitimate use: one fetch per conversation
 * partner per device per session, plus retries.
 */
const bundleLimiter = isTest
  ? noop
  : rateLimit({
      windowMs: 60 * 60 * 1000,
      limit: 120,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      // `authenticate` runs first, so req.user is set. The IP fallback exists
      // only so a misordered route cannot make every caller share one bucket,
      // and uses ipKeyGenerator so IPv6 addresses collapse to a subnet.
      keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? ""),
      message: { error: "Too many key requests. Please try again later." },
    });

export const e2eeRouter = Router();

/**
 * The directory requires an active account. The old router was `authenticate`
 * alone, so an account that registered and never verified its email could
 * publish 200 keys per request. `requireApproved` is not used: awaiting approval
 * on a claimed leadership role has nothing to do with messaging.
 */
e2eeRouter.use(authenticate, requireActive);

e2eeRouter.post(
  "/keys",
  withBody(registerKeysSchema, async (data, req, res) => {
    res.json(await registerKeyBundle(requireUser(req).id, data));
  }),
);

// Registered before "/keys/:userId": Express matches in declaration order, and
// a literal segment must win over a parameter that would also accept it.
e2eeRouter.get(
  "/keys/status",
  handle(async (req, res) => {
    res.json(await preKeyStatus(requireUser(req).id));
  }),
);

e2eeRouter.post(
  "/keys/prekeys",
  withBody(uploadPreKeysSchema, async (data, req, res) => {
    res.json(await addOneTimePreKeys(requireUser(req).id, data));
  }),
);

e2eeRouter.get(
  "/keys/:userId",
  bundleLimiter,
  withParams(userIdParamsSchema, async (params, req, res) => {
    res.json(await fetchKeyBundle(requireUser(req).id, params.userId));
  }),
);

e2eeRouter.get(
  "/queue",
  handle(async (req, res) => {
    res.json(await drainQueue(requireUser(req).id));
  }),
);
