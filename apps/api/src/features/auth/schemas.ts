import { z } from "zod";

import { SELF_ASSIGNABLE_ROLES } from "../../domain/roles";
import type { LeadershipRole } from "../../generated/prisma/enums";
import { normalizeEmail, normalizePersonName, normalizePhone, normalizeText } from "../../lib/normalize";

/**
 * Request validation for the auth surface.
 *
 * The old handlers read fields straight off `req.body` with ad-hoc truthiness
 * checks. `express-validator` was a declared dependency that was never
 * imported, so there was no validation layer at all. Notably `role` came
 * directly from the body with no whitelist.
 */

const email = z
  .string()
  .trim()
  .min(3)
  .max(150)
  .email("A valid email address is required")
  .transform(normalizeEmail);

const phoneNumber = z
  .string()
  .transform(normalizePhone)
  .refine((v) => v.startsWith("+"), {
    message: "Phone number must include a country code, for example +234...",
  })
  .refine((v) => /^\+\d{7,20}$/.test(v), { message: "Phone number is not valid" });

const fullName = z
  .string()
  .trim()
  .min(2, "Full name is required")
  .max(120)
  .transform(normalizePersonName);

/**
 * Password policy follows current NIST guidance: a meaningful length floor, a
 * generous ceiling, and no composition rules, which push people toward
 * predictable substitutions. Previously there was no policy whatsoever, so a
 * single character was accepted.
 */
const password = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .max(256, "Password must be at most 256 characters")
  .refine((v) => new Set(v).size > 2, { message: "Password is too simple" });

const otpCode = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Verification code must be 6 digits");

/** Only roles a person is allowed to claim for themselves. */
const selfAssignableRole = z
  .string()
  .refine((v): v is LeadershipRole => SELF_ASSIGNABLE_ROLES.has(v as LeadershipRole), {
    message: "That role cannot be selected during registration",
  });

const optionalText = z.string().trim().max(120).transform(normalizeText).optional();
const optionalUuid = z.string().uuid().optional();

export const registerSchema = z
  .object({
    phone_number: phoneNumber,
    full_name: fullName,
    email,
    password,
    date_of_birth: z.coerce.date().refine((d) => d < new Date(), {
      message: "Date of birth must be in the past",
    }),
    gender: z.enum(["male", "female"]).optional(),
    is_single: z.boolean().default(true),
    role: selfAssignableRole.default("ysa_member"),

    stake_id: optionalUuid,
    stake_name: optionalText,
    stake_country: optionalText,
    district_id: optionalUuid,
    district_name: optionalText,
    district_country: optionalText,
    mission_id: optionalUuid,
  })
  .superRefine((value, ctx) => {
    if (value.role === "stake_presidency" && !value.stake_name && !value.stake_id) {
      ctx.addIssue({
        code: "custom",
        path: ["stake_name"],
        message: "Stake presidency registration requires a stake",
      });
    }
    if (value.role === "district_presidency" && !value.district_name && !value.district_id) {
      ctx.addIssue({
        code: "custom",
        path: ["district_name"],
        message: "District presidency registration requires a district",
      });
    }
    if (
      (value.role === "missionary" ||
        value.role === "mission_president" ||
        value.role === "mission_president_wife") &&
      !value.mission_id
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["mission_id"],
        message: "That role requires a mission",
      });
    }
  });

export const loginSchema = z
  .object({
    phone_number: phoneNumber.optional(),
    email: email.optional(),
    password: z.string().min(1, "Password is required"),
  })
  .refine((v) => Boolean(v.email ?? v.phone_number), {
    message: "Provide an email address or a phone number",
    path: ["email"],
  });

/** An account is identified by email or phone for code delivery. */
export const identifySchema = z
  .object({
    phone_number: phoneNumber.optional(),
    email: email.optional(),
  })
  .refine((v) => Boolean(v.email ?? v.phone_number), {
    message: "Provide an email address or a phone number",
    path: ["email"],
  });

export const verifyOtpSchema = identifySchema.and(z.object({ otp: otpCode }));

export const verifyRegistrationSchema = z.object({
  email,
  otp: otpCode,
});

export const pushTokenSchema = z.object({
  fcm_token: z.string().max(4096).nullish(),
  apns_token: z.string().max(4096).nullish(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type IdentifyInput = z.infer<typeof identifySchema>;
