import { outranks, TIER, tierOf } from "../../domain/roles";
import type { LeadershipRole } from "../../generated/prisma/enums";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import type { AuthenticatedUser } from "../../middleware/auth";
import { badRequest, forbidden, notFound } from "../../middleware/errorHandler";
import { enrollMissionaryDevice, unenrollMissionaryDevice } from "./maas360";
import type { ActivateMissionaryInput, DeactivateMissionaryInput } from "./schemas";

/**
 * Missionary mode.
 *
 * The defect this file exists to close: `/missionary/activate` and
 * `/missionary/deactivate` took `user_id` from the request body and rewrote that
 * account's `role`, `status`, `mission_id` and `is_approved` with no check of any
 * kind on the target. A single request could demote or lock down any account in
 * the system, including a first presidency account, and the only gate was
 * `ROLE_TIER[req.user.role] < 4`, which passed for every role missing from that
 * table because `undefined < 4` is false.
 *
 * Now: a tier floor on the route, strict seniority over the target, and a shared
 * unit or mission.
 */

/** The upper age for YSA participation, used when restoring a returning member. */
const YSA_MAX_AGE = 35;

interface ManageableTarget {
  id: string;
  role: LeadershipRole;
  stakeId: string | null;
  districtId: string | null;
  missionId: string | null;
}

function isMissionLeader(role: LeadershipRole): boolean {
  return role === "mission_president" || role === "mission_president_wife";
}

/** The mission a mission leader presides over. */
function missionScopeOf(actor: AuthenticatedUser): string | null {
  return actor.missionPresidentMissionId ?? actor.missionId;
}

/**
 * Whether `actor` may rewrite this account's calling.
 *
 * `candidateMissionId` covers activation, where the target has no mission yet and
 * the shared unit is the mission they are being assigned to.
 */
function assertCanManageTarget(
  actor: AuthenticatedUser,
  target: ManageableTarget,
  candidateMissionId: string | null,
): void {
  if (target.id === actor.id) {
    throw forbidden("You cannot change your own missionary status.");
  }

  if (!outranks(actor.role, target.role)) {
    throw forbidden("You cannot change the calling of an account at your level or above.");
  }

  // Area authority and above act platform-wide.
  if (tierOf(actor.role) >= TIER.area) return;

  if (Boolean(actor.stakeId) && actor.stakeId === target.stakeId) return;
  if (Boolean(actor.districtId) && actor.districtId === target.districtId) return;

  if (isMissionLeader(actor.role)) {
    const mission = missionScopeOf(actor);
    if (mission && (mission === target.missionId || mission === candidateMissionId)) return;
  }

  throw forbidden("You can only manage accounts in your own stake, district or mission.");
}

/** Whole years, computed in UTC. Replaces `EXTRACT(YEAR FROM AGE(...))` in SQL. */
function ageInYears(dateOfBirth: Date | null): number | null {
  if (!dateOfBirth) return null;

  const now = new Date();
  let age = now.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const monthDelta = now.getUTCMonth() - dateOfBirth.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < dateOfBirth.getUTCDate())) {
    age -= 1;
  }
  return age;
}

// ─── Activation ─────────────────────────────────────────────────────────────

export async function activateMissionaryMode(
  actor: AuthenticatedUser,
  input: ActivateMissionaryInput,
) {
  const target = await prisma.user.findUnique({
    where: { id: input.user_id },
    select: {
      id: true,
      fullName: true,
      phoneNumber: true,
      role: true,
      stakeId: true,
      districtId: true,
      missionId: true,
      missionaryModeActive: true,
    },
  });
  if (!target) throw notFound("User not found");

  assertCanManageTarget(actor, target, input.mission_id);

  const mission = await prisma.mission.findUnique({
    where: { id: input.mission_id },
    select: { id: true, name: true },
  });
  if (!mission) throw notFound("Mission not found");

  const startDate = input.start_date ?? new Date();
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: target.id },
      data: {
        role: "missionary",
        status: "missionary",
        missionaryModeActive: true,
        missionId: mission.id,
        missionaryStartDate: startDate,
        missionaryEndDate: null,
        // The leader making this change outranks the target and shares a unit
        // with them, so this is a real approval decision by a real reviewer.
        isApproved: true,
        approvedById: actor.id,
        approvedAt: now,
      },
    });

    // A serving missionary is out of the YSA pool for the duration.
    await tx.stakePoolMember.updateMany({
      where: { userId: target.id },
      data: { approved: false, approvedAt: null },
    });
  });

  logger.info("missionary mode activated", {
    targetId: target.id,
    actorId: actor.id,
    missionId: mission.id,
  });

  // Device management is attempted after the account change and reported
  // separately, because it can legitimately be unavailable. It never claims to
  // have done something it did not do.
  const mdm = await enrollMissionaryDevice(target.id, target.phoneNumber, target.fullName);

  // INTEGRATION: notify the missionary that missionary mode is now active.

  return {
    message: `${target.fullName} is now in missionary mode for ${mission.name}.`,
    mdm,
  };
}

// ─── Deactivation ───────────────────────────────────────────────────────────

export async function deactivateMissionaryMode(
  actor: AuthenticatedUser,
  input: DeactivateMissionaryInput,
) {
  const target = await prisma.user.findUnique({
    where: { id: input.user_id },
    select: {
      id: true,
      fullName: true,
      role: true,
      dateOfBirth: true,
      stakeId: true,
      districtId: true,
      missionId: true,
      missionaryModeActive: true,
    },
  });
  if (!target) throw notFound("User not found");

  assertCanManageTarget(actor, target, null);

  if (target.role !== "missionary" && !target.missionaryModeActive) {
    throw badRequest("That account is not in missionary mode.");
  }

  const age = ageInYears(target.dateOfBirth);
  const ysaEligible = age !== null && age <= YSA_MAX_AGE;
  const endedAt = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: target.id },
      data: {
        role: "ysa_member",
        status: "active",
        missionaryModeActive: false,
        missionaryEndDate: endedAt,
      },
    });

    // Pool membership comes back unapproved: a returning missionary has to be
    // re-approved by their unit's YSA rep.
    if (ysaEligible && target.stakeId) {
      await tx.stakePoolMember.upsert({
        where: { userId_stakeId: { userId: target.id, stakeId: target.stakeId } },
        create: { userId: target.id, stakeId: target.stakeId, approved: false },
        update: { approved: false, approvedAt: null },
      });
    } else if (ysaEligible && target.districtId) {
      await tx.stakePoolMember.upsert({
        where: { userId_districtId: { userId: target.id, districtId: target.districtId } },
        create: { userId: target.id, districtId: target.districtId, approved: false },
        update: { approved: false, approvedAt: null },
      });
    }
  });

  logger.info("missionary mode deactivated", {
    targetId: target.id,
    actorId: actor.id,
    ysaEligible,
  });

  const mdm = await unenrollMissionaryDevice(target.id);

  // INTEGRATION: notify the returning missionary, and their YSA rep if pool
  // membership needs re-approval.

  return {
    message: ysaEligible
      ? `${target.fullName} has returned. YSA access restored; the unit YSA rep must re-approve pool membership.`
      : `${target.fullName} has returned. The account was restored as a general member.`,
    mdm,
  };
}

// ─── Reads ──────────────────────────────────────────────────────────────────

/**
 * Missionaries serving in one mission.
 *
 * Visible to that mission's president and to area authorities and above, as
 * before, but the tier comparison now goes through `tierOf`, which cannot return
 * undefined for a role that is missing from a hand-maintained table.
 */
export async function listMissionMembers(actor: AuthenticatedUser, missionId: string) {
  const isPresidentOfMission =
    actor.role === "mission_president" && missionScopeOf(actor) === missionId;

  if (!isPresidentOfMission && tierOf(actor.role) < TIER.area) {
    throw forbidden("Access denied");
  }

  const members = await prisma.user.findMany({
    where: { missionId, role: "missionary" },
    select: {
      id: true,
      fullName: true,
      phoneNumber: true,
      profilePhotoUrl: true,
      missionaryStartDate: true,
      status: true,
      dateOfBirth: true,
      maas360Enrolled: true,
    },
    orderBy: { fullName: "asc" },
  });

  return members.map(({ dateOfBirth, ...member }) => ({
    ...member,
    age: ageInYears(dateOfBirth),
  }));
}

/** Mission presidents and their spouses. Route-gated to council tier and above. */
export async function listMissionPresidents() {
  return prisma.user.findMany({
    where: { role: { in: ["mission_president", "mission_president_wife"] } },
    select: {
      id: true,
      fullName: true,
      phoneNumber: true,
      profilePhotoUrl: true,
      role: true,
      missionPresidentMissionId: true,
      missionPresidentMission: { select: { id: true, name: true } },
      spouse: { select: { id: true, fullName: true, profilePhotoUrl: true } },
    },
    orderBy: { fullName: "asc" },
  });
}
