import { isHiddenRole, tierOf } from "../../domain/roles";
import type { Prisma } from "../../generated/prisma/client";
import type { LeadershipRole } from "../../generated/prisma/enums";
import { logger } from "../../lib/logger";
import { normalizeEmail, phoneVariants } from "../../lib/normalize";
import { prisma } from "../../lib/prisma";
import type { AuthenticatedUser } from "../../middleware/auth";
import { badRequest, conflict, forbidden, notFound } from "../../middleware/errorHandler";
import type { SearchQuery, UpdateMeInput } from "./schemas";

// ─── Visibility rules ───────────────────────────────────────────────────────
// Ported from utils/accessControl.js. That module also carried its own ROLE_TIER
// table, which is now domain/roles.ts, so tier comparisons here are exhaustive
// over the role enum instead of returning `undefined` for the roles the old
// table forgot.

/** The fields a visibility decision needs about the person being looked at. */
export interface ProfileSubject {
  id: string;
  role: LeadershipRole;
  missionId: string | null;
  missionPresidentMissionId: string | null;
}

/**
 * Whether `viewer` may see `target`'s profile at all.
 *
 * One correctness fix over the original: every mission comparison now requires
 * the viewer's mission to be set. The old code compared `viewer.mission_id ===
 * target.mission_id` directly, so two accounts with no mission (`null === null`)
 * matched, and a missionary with no mission assigned could read the profile of
 * any mission president who also had none.
 */
export function canViewProfile(viewer: AuthenticatedUser, target: ProfileSubject): boolean {
  if (viewer.id === target.id) return true;

  // IT support is the break-glass role. It is named explicitly here rather than
  // short-circuiting the whole authorization layer, which is what the old
  // requireRole middleware did.
  if (viewer.role === "it_support") return true;

  // A missionary, or anyone with missionary mode active, sees their mission and
  // nothing else.
  if (viewer.role === "missionary" || viewer.missionaryModeActive) {
    if (viewer.missionId === null) return false;
    if (target.role === "missionary") return viewer.missionId === target.missionId;
    if (target.role === "mission_president" || target.role === "mission_president_wife") {
      return viewer.missionId === target.missionPresidentMissionId;
    }
    return false;
  }

  // Mission presidents see their peers, and the missionaries they preside over.
  if (viewer.role === "mission_president" || viewer.role === "mission_president_wife") {
    if (target.role === "mission_president" || target.role === "mission_president_wife") return true;
    if (target.role === "missionary") {
      return (
        viewer.missionPresidentMissionId !== null &&
        target.missionId === viewer.missionPresidentMissionId
      );
    }
  }

  // Senior leaders are visible only to their own tier and above.
  if (isHiddenRole(target.role)) return tierOf(viewer.role) >= tierOf(target.role);

  // Otherwise members and leaders are mutually visible in both directions.
  return true;
}

/** Missionary mode locks an account down to mission-scoped features. */
function isMissionaryLocked(user: {
  role: LeadershipRole;
  status: string;
  missionaryModeActive: boolean;
}): boolean {
  return user.missionaryModeActive || user.status === "missionary" || user.role === "missionary";
}

/**
 * Feature flags returned with the caller's own profile so the client can hide
 * what the server would refuse anyway. These are a UI hint, never the
 * enforcement point: every flag below has a matching server-side check.
 */
export function featureFlags(user: {
  role: LeadershipRole;
  status: string;
  missionaryModeActive: boolean;
}): Record<string, boolean> {
  const locked = isMissionaryLocked(user);
  return {
    canBrowseStakePool: !locked,
    canCreateOpenGroups: !locked,
    canJoinCrossStakeGroups: !locked,
    canViewYSADirectory: !locked,
    canSearchGlobally: true,
    canSendMessages: true,
    canMakeVoiceCalls: true,
    canMakeVideoCalls: true,
    canSendMedia: true,
    canPinChats: true,
    canViewScriptures: true,
    missionaryModeActive: locked,
    missionScopedOnly: locked,
  };
}

/**
 * Whether the two accounts have an accepted contact connection.
 *
 * Rows are stored once per pair with the ids ordered, enforced by a CHECK
 * constraint, so the lookup has to order them the same way.
 */
async function areConnected(a: string, b: string): Promise<boolean> {
  const low = a < b ? a : b;
  const high = a < b ? b : a;
  const connection = await prisma.contactConnection.findUnique({
    where: { userLowId_userHighId: { userLowId: low, userHighId: high } },
    select: { id: true },
  });
  return connection !== null;
}

// ─── Shared shaping ─────────────────────────────────────────────────────────

/**
 * Fields loaded for a profile read. `passwordHash` is absent and must stay
 * absent: nothing in this feature ever needs it.
 */
const PROFILE_SELECT = {
  id: true,
  fullName: true,
  phoneNumber: true,
  email: true,
  emailVerified: true,
  role: true,
  status: true,
  dateOfBirth: true,
  isSingle: true,
  profilePhotoUrl: true,
  bio: true,
  isApproved: true,
  stakeId: true,
  districtId: true,
  missionId: true,
  missionPresidentMissionId: true,
  missionaryModeActive: true,
  profileHidden: true,
  directoryVisible: true,
  contactRequestPreference: true,
  lastSeen: true,
  createdAt: true,
  stake: { select: { name: true } },
  district: { select: { name: true } },
  mission: { select: { name: true } },
} as const;

/**
 * Age in whole years, computed in UTC because `date_of_birth` is a DATE column
 * and Prisma hands it back as UTC midnight. Doing this in JavaScript replaces
 * `EXTRACT(YEAR FROM AGE(...))`, which was one of the reasons these reads were
 * raw SQL.
 */
function ageFrom(dateOfBirth: Date | null): number | null {
  if (!dateOfBirth) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const months = now.getUTCMonth() - dateOfBirth.getUTCMonth();
  if (months < 0 || (months === 0 && now.getUTCDate() < dateOfBirth.getUTCDate())) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

// ─── GET /users/me ──────────────────────────────────────────────────────────

export async function getMyProfile(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: PROFILE_SELECT });
  if (!user) throw notFound("User not found");

  return {
    id: user.id,
    fullName: user.fullName,
    phoneNumber: user.phoneNumber,
    email: user.email,
    emailVerified: user.emailVerified,
    role: user.role,
    status: user.status,
    age: ageFrom(user.dateOfBirth),
    isSingle: user.isSingle,
    profilePhotoUrl: user.profilePhotoUrl,
    bio: user.bio,
    isApproved: user.isApproved,
    stakeId: user.stakeId,
    stakeName: user.stake?.name ?? null,
    districtId: user.districtId,
    districtName: user.district?.name ?? null,
    missionId: user.missionId,
    missionName: user.mission?.name ?? null,
    missionaryModeActive: user.missionaryModeActive,
    profileHidden: user.profileHidden,
    directoryVisible: user.directoryVisible,
    contactRequestPreference: user.contactRequestPreference,
    lastSeen: user.lastSeen,
    createdAt: user.createdAt,
    features: featureFlags(user),
  };
}

// ─── PATCH /users/me ────────────────────────────────────────────────────────

export async function updateMyProfile(userId: string, input: UpdateMeInput) {
  const current = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  if (!current) throw notFound("User not found");

  // `email` arrives already trimmed and lowercased from the schema, so this
  // comparison and the uniqueness check below both operate on the stored form.
  const emailChanged = input.email !== undefined && input.email !== current.email;

  if (emailChanged && input.email) {
    const taken = await prisma.user.findFirst({
      where: { email: input.email, id: { not: userId } },
      select: { id: true },
    });
    if (taken) throw conflict("That email address is already registered.");
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(input.full_name !== undefined ? { fullName: input.full_name } : {}),
      ...(input.bio !== undefined ? { bio: input.bio } : {}),
      ...(input.profile_photo_url !== undefined
        ? { profilePhotoUrl: input.profile_photo_url }
        : {}),
      // A new address is unverified until it proves it can receive mail.
      // Otherwise anyone could point the account at an address they do not own
      // and keep a verified flag they never earned.
      // INTEGRATION: on an email change, the auth feature should issue and send
      // a verification code to the new address, the same way registration does.
      ...(emailChanged ? { email: input.email ?? null, emailVerified: false } : {}),
    },
    select: PROFILE_SELECT,
  });

  logger.info("profile updated", {
    userId,
    fields: Object.keys(input),
    emailChanged,
  });

  return {
    id: updated.id,
    fullName: updated.fullName,
    email: updated.email,
    emailVerified: updated.emailVerified,
    bio: updated.bio,
    profilePhotoUrl: updated.profilePhotoUrl,
  };
}

// ─── GET /users/search ─────────────────────────────────────────────────────

/**
 * Directory search.
 *
 * Three changes from the original, beyond the move off raw SQL:
 *
 *   - `directory_visible` is filtered in the query rather than in JavaScript
 *     after the fact, and `profile_hidden` is honoured at all. The old code
 *     selected `profile_hidden` and never looked at it.
 *   - `%` and `_` are stripped from the term. They went straight into an ILIKE
 *     pattern before, so a search for `%` matched every user in the system.
 *   - email and phone match exactly instead of by substring. Substring matching
 *     on those columns turns search into a contact-detail oracle: probing
 *     `@gmail.com` or an area code enumerated accounts a caller had no other
 *     way to find.
 */
export async function searchUsers(viewer: AuthenticatedUser, params: SearchQuery) {
  const term = params.q;
  // ILIKE metacharacters. Prisma parameterizes the value but does not escape
  // wildcards, and it cannot emit an ESCAPE clause, so they are removed.
  const nameTerm = term.replace(/[%_\\]/g, "").trim();

  const or: Prisma.UserWhereInput[] = [];
  if (nameTerm.length >= 2) {
    or.push({ fullName: { contains: nameTerm, mode: "insensitive" } });
  }
  if (term.includes("@")) {
    or.push({ email: normalizeEmail(term) });
  }
  if (/^\+?[\d\s()-]{7,}$/.test(term)) {
    or.push({ phoneNumber: { in: phoneVariants(term) } });
  }
  if (or.length === 0) return { data: [] };

  const rows = await prisma.user.findMany({
    where: {
      OR: or,
      id: { not: viewer.id },
      status: { not: "suspended" },
      directoryVisible: true,
      profileHidden: false,
    },
    select: {
      id: true,
      fullName: true,
      role: true,
      status: true,
      profilePhotoUrl: true,
      stakeId: true,
      missionId: true,
      missionPresidentMissionId: true,
      missionaryModeActive: true,
      stake: { select: { name: true } },
    },
    orderBy: { fullName: "asc" },
    take: params.limit,
  });

  // Contact details are deliberately not selected. Search results are a way to
  // find someone and send them a contact request, not a way to harvest phone
  // numbers and email addresses.
  const data = rows
    .filter((row) => canViewProfile(viewer, row))
    .map((row) => ({
      id: row.id,
      fullName: row.fullName,
      role: row.role,
      status: row.status,
      profilePhotoUrl: row.profilePhotoUrl,
      stakeId: row.stakeId,
      stakeName: row.stake?.name ?? null,
      missionId: row.missionId,
      missionaryModeActive: row.missionaryModeActive,
    }));

  return { data };
}

// ─── GET /users/:id ────────────────────────────────────────────────────────

/**
 * A single profile.
 *
 * The old handler returned `phone_number` and `email` to any approved caller
 * who passed `canViewProfile`, while search stripped exactly those columns.
 * That inconsistency made the privacy filtering in search pointless: anyone
 * could read the id from a group or an announcement and fetch the details
 * directly. Contact details and presence now require an accepted connection.
 *
 * Both "no such user" and "not allowed to see this user" answer 404. A 403 here
 * would confirm that an id exists, which is the one bit a caller who cannot see
 * the profile should not learn.
 */
export async function getUserProfile(viewer: AuthenticatedUser, targetId: string) {
  if (targetId === viewer.id) return getMyProfile(viewer.id);

  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: PROFILE_SELECT,
  });
  if (!target || target.status === "suspended") throw notFound("User not found");
  if (!canViewProfile(viewer, target)) throw notFound("User not found");

  const connected = await areConnected(viewer.id, target.id);

  // A hidden profile is visible to an existing contact and to IT support only.
  // `profile_hidden` existed on the old row and was never checked anywhere.
  if (target.profileHidden && !connected && viewer.role !== "it_support") {
    throw notFound("User not found");
  }

  const trusted = connected || viewer.role === "it_support";

  return {
    id: target.id,
    fullName: target.fullName,
    role: target.role,
    status: target.status,
    age: ageFrom(target.dateOfBirth),
    profilePhotoUrl: target.profilePhotoUrl,
    bio: target.bio,
    stakeId: target.stakeId,
    stakeName: target.stake?.name ?? null,
    missionId: target.missionId,
    missionName: target.mission?.name ?? null,
    missionaryModeActive: target.missionaryModeActive,
    contactRequestPreference: target.contactRequestPreference,
    connected,
    // Contact details and last-seen only for people already connected.
    phoneNumber: trusted ? target.phoneNumber : null,
    email: trusted ? target.email : null,
    lastSeen: trusted ? target.lastSeen : null,
  };
}

// ─── GET /users/stake-pool ─────────────────────────────────────────────────

/** Hard ceiling on a pool listing. Pagination can come later if a pool grows. */
const POOL_PAGE_SIZE = 500;

/**
 * The YSA pool for the caller's own unit.
 *
 * Two defects fixed here. First, the old query was scoped to nobody: it checked
 * `if (!user.stake_id) return 400` and then ran a query with an empty parameter
 * list, returning approved members of every pool-active stake in the world.
 * Second, it joined `stake_pool_members` to `stakes` on `stake_id`, so district
 * pools could never appear even though the schema now supports them.
 *
 * Phone numbers are also no longer returned. Handing a caller the phone number
 * of every YSA in their stake defeats the point of the contact-request flow.
 */
export async function getStakePool(viewer: AuthenticatedUser) {
  if (!featureFlags(viewer).canBrowseStakePool) {
    throw forbidden("Missionary mode is active, so the YSA pool is unavailable.");
  }

  const scope = viewer.stakeId
    ? { stakeId: viewer.stakeId, stake: { ysaPoolActive: true } }
    : viewer.districtId
      ? { districtId: viewer.districtId, district: { ysaPoolActive: true } }
      : null;

  if (!scope) throw badRequest("No stake or district assigned");

  const members = await prisma.stakePoolMember.findMany({
    where: {
      ...scope,
      approved: true,
      user: {
        status: "active",
        missionaryModeActive: false,
        directoryVisible: true,
        profileHidden: false,
      },
    },
    select: {
      stakeId: true,
      districtId: true,
      stake: { select: { name: true } },
      district: { select: { name: true } },
      user: {
        select: {
          id: true,
          fullName: true,
          profilePhotoUrl: true,
          dateOfBirth: true,
          role: true,
          isSingle: true,
        },
      },
    },
    orderBy: { user: { fullName: "asc" } },
    take: POOL_PAGE_SIZE,
  });

  const data = members.map((member) => ({
    id: member.user.id,
    fullName: member.user.fullName,
    profilePhotoUrl: member.user.profilePhotoUrl,
    age: ageFrom(member.user.dateOfBirth),
    role: member.user.role,
    isSingle: member.user.isSingle,
    stakeId: member.stakeId,
    stakeName: member.stake?.name ?? null,
    districtId: member.districtId,
    districtName: member.district?.name ?? null,
  }));

  return { data };
}
