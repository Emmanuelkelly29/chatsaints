import { Router } from "express";
import rateLimit from "express-rate-limit";

import { isProduction, isTest } from "../../config/env";
import { authenticate, requireUser } from "../../middleware/auth";
import { withBody } from "../../middleware/validate";
import {
  login,
  register,
  requestOtp,
  updatePushToken,
  verifyOtpLogin,
  verifyRegistration,
} from "./service";
import {
  identifySchema,
  loginSchema,
  pushTokenSchema,
  registerSchema,
  verifyOtpSchema,
  verifyRegistrationSchema,
} from "./schemas";

const noop = (_req: unknown, _res: unknown, next: () => void) => {
  next();
};

const WINDOW_MS = 15 * 60 * 1000;

/**
 * Budgets are deliberately different in development.
 *
 * Production values protect real accounts. Development values have to survive
 * someone iterating on a signup form, where a handful of typos is normal and
 * being locked out for fifteen minutes is not a security win, just lost time.
 */
const CREDENTIAL_LIMIT = isProduction ? 20 : 200;
const CODE_REQUEST_LIMIT = isProduction ? 5 : 100;

/**
 * Sign-in attempts. Failures deliberately DO count, because counting them is
 * the entire point: this is what makes credential stuffing expensive.
 */
const credentialLimiter = isTest
  ? noop
  : rateLimit({
      windowMs: WINDOW_MS,
      limit: CREDENTIAL_LIMIT,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      message: { error: "Too many attempts. Please try again later." },
    });

/**
 * Requesting a code is more expensive than checking one, because it sends mail.
 *
 * `skipFailedRequests` matters here. This limiter guards the cost of sending
 * email, so only a request that actually sent something should count. Without
 * it the limiter ran before validation, so five rejected bodies exhausted the
 * budget without a single message being sent, and the caller was locked out of
 * an action they had never successfully performed.
 *
 * Per-account attempt limiting lives in the OTP store, which covers an attacker
 * rotating source IPs to get past a per-IP limiter.
 */
const codeRequestLimiter = isTest
  ? noop
  : rateLimit({
      windowMs: WINDOW_MS,
      limit: CODE_REQUEST_LIMIT,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      skipFailedRequests: true,
      message: { error: "Too many code requests. Please try again later." },
    });

export const authRouter = Router();

authRouter.post(
  "/register",
  codeRequestLimiter,
  withBody(registerSchema, async (data, _req, res) => {
    res.status(201).json(await register(data));
  }),
);

authRouter.post(
  "/verify-registration",
  credentialLimiter,
  withBody(verifyRegistrationSchema, async (data, _req, res) => {
    res.json(await verifyRegistration(data.email, data.otp));
  }),
);

authRouter.post(
  "/login",
  credentialLimiter,
  withBody(loginSchema, async (data, _req, res) => {
    res.json(await login(data));
  }),
);

authRouter.post(
  "/send-otp",
  codeRequestLimiter,
  withBody(identifySchema, async (data, _req, res) => {
    res.json(await requestOtp("login", data));
  }),
);

authRouter.post(
  "/verify-otp",
  credentialLimiter,
  withBody(verifyOtpSchema, async (data, _req, res) => {
    res.json(await verifyOtpLogin("login", data, data.otp));
  }),
);

authRouter.post(
  "/send-session-otp",
  codeRequestLimiter,
  withBody(identifySchema, async (data, _req, res) => {
    res.json(await requestOtp("session", data));
  }),
);

authRouter.post(
  "/verify-session-otp",
  credentialLimiter,
  withBody(verifyOtpSchema, async (data, _req, res) => {
    res.json(await verifyOtpLogin("session", data, data.otp));
  }),
);

authRouter.patch(
  "/push-token",
  authenticate,
  withBody(pushTokenSchema, async (data, req, res) => {
    await updatePushToken(requireUser(req).id, data);
    res.json({ message: "Push token updated" });
  }),
);
