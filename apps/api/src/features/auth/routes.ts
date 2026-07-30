import { Router } from "express";
import rateLimit from "express-rate-limit";

import { isTest } from "../../config/env";
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

/**
 * Credential endpoints get a tighter budget than the rest of the API. The old
 * limit was 50 attempts per 15 minutes across the whole /api/auth surface.
 */
const credentialLimiter = isTest
  ? noop
  : rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 20,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      message: { error: "Too many attempts. Please try again later." },
    });

/**
 * Requesting a code is more expensive than checking one, because it sends mail.
 * Per-account attempt limiting lives in the OTP store, which covers the case of
 * an attacker rotating source IPs to get past a per-IP limiter.
 */
const codeRequestLimiter = isTest
  ? noop
  : rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 5,
      standardHeaders: "draft-7",
      legacyHeaders: false,
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
