import bcrypt from "bcryptjs";

import { requiresLeaderApproval } from "../../domain/roles";
import { describeError, logger } from "../../lib/logger";
import { normalizeText, phoneVariants } from "../../lib/normalize";
import { prisma } from "../../lib/prisma";
import { signAccessToken } from "../../lib/tokens";
import { isSmtpConfigured } from "../../config/env";
import { conflict, forbidden, HttpError, unauthorized } from "../../middleware/errorHandler";
import { sendOtpEmail } from "./mailer";
import { consumeOtp, issueOtp, otpFailureMessage, type OtpPurpose } from "./otp";
import type { LoginInput, RegisterInput } from "./schemas";

const BCRYPT_ROUNDS = 12;

/**
 * A bcrypt hash of a value nobody knows, compared against when no account
 * matches. Without it, "no such user" returns measurably faster than "wrong
 * password", which turns login into an account-existence oracle.
 */
const DUMMY_HASH = "$2b$12$C6UzMDM.H6dfI/f/IKcEe.HxJmiKvcPO/vaBTfmL/JT1MkGqbnMHK";

/** Fields safe to return to the account owner. Never includes passwordHash. */
const PUBLIC_USER_SELECT = {
  id: true,
  fullName: true,
  phoneNumber: true,
  email: true,
  emailVerified: true,
  role: true,
  status: true,
  isApproved: true,
  stakeId: true,
  districtId: true,
  missionId: true,
  missionaryModeActive: true,
  profileHidden: true,
  directoryVisible: true,
  contactRequestPreference: true,
} as const;

export type PublicUser = Awaited<ReturnType<typeof findPublicUser>>;

async function findPublicUser(id: string) {
  return prisma.user.findUniqueOrThrow({ where: { id }, select: PUBLIC_USER_SELECT });
}

export interface AuthResult {
  token: string;
  user: Awaited<ReturnType<typeof findPublicUser>>;
}

async function issueSession(userId: string): Promise<AuthResult> {
  await prisma.user.update({ where: { id: userId }, data: { lastSeen: new Date() } });
  return { token: signAccessToken(userId), user: await findPublicUser(userId) };
}

// ─── Geography resolution ───────────────────────────────────────────────────
// Leaders register against a stake or district by name, creating it if it does
// not exist yet. Matching is case-insensitive on trimmed name plus country.

async function resolveStakeId(
  id: string | undefined,
  name: string | undefined,
  country: string | undefined,
): Promise<string | null> {
  if (id) return id;
  const cleanName = name ? normalizeText(name) : "";
  if (!cleanName) return null;
  const cleanCountry = country ? normalizeText(country) : "";

  const existing = await prisma.stake.findFirst({
    where: {
      name: { equals: cleanName, mode: "insensitive" },
      ...(cleanCountry ? { country: { equals: cleanCountry, mode: "insensitive" } } : {}),
    },
    select: { id: true, country: true },
  });

  if (existing) {
    if (cleanCountry && !existing.country) {
      await prisma.stake.update({ where: { id: existing.id }, data: { country: cleanCountry } });
    }
    return existing.id;
  }

  const created = await prisma.stake.create({
    data: { name: cleanName, country: cleanCountry || null },
    select: { id: true },
  });
  return created.id;
}

async function resolveDistrictId(
  id: string | undefined,
  name: string | undefined,
  country: string | undefined,
): Promise<string | null> {
  if (id) return id;
  const cleanName = name ? normalizeText(name) : "";
  if (!cleanName) return null;
  const cleanCountry = country ? normalizeText(country) : "";

  const existing = await prisma.district.findFirst({
    where: {
      name: { equals: cleanName, mode: "insensitive" },
      ...(cleanCountry ? { country: { equals: cleanCountry, mode: "insensitive" } } : {}),
    },
    select: { id: true, country: true },
  });

  if (existing) {
    if (cleanCountry && !existing.country) {
      await prisma.district.update({ where: { id: existing.id }, data: { country: cleanCountry } });
    }
    return existing.id;
  }

  const created = await prisma.district.create({
    data: { name: cleanName, country: cleanCountry || null },
    select: { id: true },
  });
  return created.id;
}

// ─── Registration ───────────────────────────────────────────────────────────

export interface RegisterResult {
  pending: true;
  email: string;
  message: string;
}

export async function register(input: RegisterInput): Promise<RegisterResult> {
  // Fail before writing anything. Registration cannot complete without a
  // deliverable code, so creating the account first would leave an
  // unverifiable row behind every time delivery was impossible.
  if (!isSmtpConfigured) {
    throw new HttpError(
      503,
      "Registration is unavailable because email delivery is not configured on this server.",
    );
  }

  const variants = phoneVariants(input.phone_number);

  const [phoneTaken, emailTaken] = await Promise.all([
    prisma.user.findFirst({ where: { phoneNumber: { in: variants } }, select: { id: true } }),
    prisma.user.findUnique({ where: { email: input.email }, select: { id: true } }),
  ]);
  if (phoneTaken) throw conflict("That phone number is already registered.");
  if (emailTaken) throw conflict("That email address is already registered.");

  const [stakeId, districtId] = await Promise.all([
    resolveStakeId(input.stake_id, input.stake_name, input.stake_country),
    resolveDistrictId(input.district_id, input.district_name, input.district_country),
  ]);

  const role = input.role;
  const needsApproval = requiresLeaderApproval(role);

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  // One transaction so a failure cannot leave a user without their approval
  // record or pool membership.
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        phoneNumber: input.phone_number,
        fullName: input.full_name,
        email: input.email,
        passwordHash,
        dateOfBirth: input.date_of_birth,
        gender: input.gender ?? null,
        isSingle: input.is_single,
        role,
        // Approval gates the claimed role. Registration never grants it.
        isApproved: !needsApproval,
        status: "pending_approval",
        emailVerified: false,
        stakeId,
        districtId,
        missionId: input.mission_id ?? null,
      },
      select: { id: true },
    });

    if (needsApproval) {
      await tx.leaderApproval.create({
        data: { applicantId: created.id, declaredRole: role, status: "pending" },
      });
    }

    if (role === "ysa_member" && (stakeId || districtId)) {
      await tx.stakePoolMember.create({
        data: {
          userId: created.id,
          // The CHECK constraint permits exactly one of these.
          stakeId: stakeId ?? null,
          districtId: stakeId ? null : districtId,
          approved: false,
        },
      });
    }

    return created;
  });

  // If the code cannot be delivered the account is unreachable, so undo it
  // rather than leaving a row nobody can ever verify.
  try {
    await deliverOtp("register", input.email, "Verify your email to finish signing up");
  } catch (error) {
    await prisma.user.delete({ where: { id: user.id } }).catch((cleanupError: unknown) => {
      logger.error("failed to roll back registration", {
        userId: user.id,
        ...describeError(cleanupError),
      });
    });
    throw error;
  }

  logger.info("registration started", { userId: user.id, role, needsApproval });

  return {
    pending: true,
    email: input.email,
    message: "A 6-digit verification code has been sent to your email address.",
  };
}

export async function verifyRegistration(email: string, otp: string): Promise<AuthResult> {
  const result = await consumeOtp("register", email, otp);
  if (!result.ok) throw unauthorized(otpFailureMessage(result.reason));

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, status: true } });
  if (!user) throw unauthorized("Account not found.");
  if (user.status === "suspended") throw forbidden("Account suspended.");

  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerified: true, status: "active" },
  });

  return issueSession(user.id);
}

// ─── Password login ─────────────────────────────────────────────────────────

export async function login(input: LoginInput): Promise<AuthResult> {
  const user = input.email
    ? await prisma.user.findUnique({
        where: { email: input.email },
        select: { id: true, status: true, passwordHash: true },
      })
    : await prisma.user.findFirst({
        where: { phoneNumber: { in: phoneVariants(input.phone_number ?? "") } },
        select: { id: true, status: true, passwordHash: true },
      });

  // Always run a comparison, so response time does not reveal whether the
  // account exists.
  const valid = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || !valid) throw unauthorized("Invalid credentials");
  if (user.status === "suspended") throw forbidden("Account suspended.");

  return issueSession(user.id);
}

// ─── Code-based login and session refresh ───────────────────────────────────

async function deliverOtp(purpose: OtpPurpose, email: string, subject: string): Promise<void> {
  const { code } = await issueOtp(purpose, email);
  // The code is never logged and never returned in a response.
  await sendOtpEmail(email, code, `ChatSaints: ${subject}`);
}

/** Resolves an identifier to an account email, or null if there is no account. */
async function emailForIdentifier(identifier: {
  email?: string;
  phone_number?: string;
}): Promise<string | null> {
  if (identifier.email) {
    const user = await prisma.user.findUnique({
      where: { email: identifier.email },
      select: { email: true },
    });
    return user?.email ?? null;
  }
  if (!identifier.phone_number) return null;
  const user = await prisma.user.findFirst({
    where: { phoneNumber: { in: phoneVariants(identifier.phone_number) } },
    select: { email: true },
  });
  return user?.email ?? null;
}

/**
 * Sends a code if the account exists, and reports the same thing either way.
 *
 * The old endpoints returned 404 "No account found with that email address",
 * which let anyone enumerate registered users and, before the `dev_otp` leak was
 * removed, hand them a working code as well.
 */
export async function requestOtp(
  purpose: Extract<OtpPurpose, "login" | "session">,
  identifier: { email?: string; phone_number?: string },
): Promise<{ message: string }> {
  const email = await emailForIdentifier(identifier);

  if (email) {
    const subject = purpose === "session" ? "Session refresh code" : "Your sign-in code";
    try {
      await deliverOtp(purpose, email, subject);
    } catch (error) {
      // A delivery failure must not become an existence oracle either. Log it
      // and return the same generic message.
      logger.error("otp delivery failed", { purpose, ...describeError(error) });
    }
  }

  return {
    message: "If an account matches those details, a verification code has been sent to it.",
  };
}

export async function verifyOtpLogin(
  purpose: Extract<OtpPurpose, "login" | "session">,
  identifier: { email?: string; phone_number?: string },
  otp: string,
): Promise<AuthResult> {
  const email = await emailForIdentifier(identifier);
  if (!email) throw unauthorized("Invalid verification code.");

  const result = await consumeOtp(purpose, email, otp);
  if (!result.ok) throw unauthorized(otpFailureMessage(result.reason));

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, status: true },
  });
  if (!user) throw unauthorized("Invalid verification code.");
  if (user.status === "suspended") throw forbidden("Account suspended.");

  return issueSession(user.id);
}

// ─── Push tokens ────────────────────────────────────────────────────────────

export async function updatePushToken(
  userId: string,
  tokens: { fcm_token?: string | null; apns_token?: string | null },
): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      ...(tokens.fcm_token !== undefined ? { fcmToken: tokens.fcm_token } : {}),
      ...(tokens.apns_token !== undefined ? { apnsToken: tokens.apns_token } : {}),
    },
  });
}
