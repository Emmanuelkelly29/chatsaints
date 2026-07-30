import { outranks, TIER, tierOf } from "../../domain/roles";
import type { Prisma } from "../../generated/prisma/client";
import { LeadershipRole } from "../../generated/prisma/enums";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import type { AuthenticatedUser } from "../../middleware/auth";
import { conflict, forbidden, notFound } from "../../middleware/errorHandler";
import type { ApprovalListQuery, RejectApprovalInput } from "./schemas";

/**
 * Leadership approval review.
 *
 * Three defects from the old controller are fixed here:
 *
 *   1. Peer approval. `approverTier >= ROLE_TIER[declaredRole]` let a bishop
 *      approve other bishops and a stake presidency approve its own tier.
 *      Review now requires STRICT seniority through `outranks`.
 *   2. No geographic scoping. Any bishop anywhere could approve any applicant
 *      anywhere. Reviewers below area authority are now confined to their own
 *      stake or district, and mission leaders to their own mission.
 *   3. Self-approval. Nothing stopped an applicant from reviewing their own
 *      pending application, which turned a self-declared role into a real one.
 */

const ALL_ROLES: LeadershipRole[] = Object.values(LeadershipRole);

/** Area authority and above review platform-wide. Everyone else is scoped. */
function hasGlobalReach(actor: AuthenticatedUser): boolean {
  return tierOf(actor.role) >= TIER.area;
}

function isMissionLeader(role: LeadershipRole): boolean {
  return role === "mission_president" || role === "mission_president_wife";
}

/**
 * The mission a mission leader presides over.
 *
 * `missionPresidentMissionId` is the authoritative field; `missionId` is the
 * fallback, because the registration flow writes the submitted mission there.
 */
function missionScopeOf(actor: AuthenticatedUser): string | null {
  return actor.missionPresidentMissionId ?? actor.missionId;
}

/** The stake or district a scoped reviewer may act within, if any. */
function unitScopeOf(actor: AuthenticatedUser): Prisma.UserWhereInput | null {
  const clauses: Prisma.UserWhereInput[] = [];
  if (actor.stakeId) clauses.push({ stakeId: actor.stakeId });
  if (actor.districtId) clauses.push({ districtId: actor.districtId });
  return clauses.length > 0 ? { OR: clauses } : null;
}

/** Roles this actor strictly outranks, and may therefore review. */
function reviewableRoles(actorRole: LeadershipRole): LeadershipRole[] {
  return ALL_ROLES.filter((role) => outranks(actorRole, role));
}

const APPROVAL_SELECT = {
  id: true,
  declaredRole: true,
  status: true,
  createdAt: true,
  applicant: {
    select: {
      id: true,
      fullName: true,
      phoneNumber: true,
      email: true,
      dateOfBirth: true,
      role: true,
      stakeId: true,
      districtId: true,
      missionId: true,
      stake: { select: { id: true, name: true } },
      district: { select: { id: true, name: true } },
      mission: { select: { id: true, name: true } },
    },
  },
} as const;

// ─── Listing ────────────────────────────────────────────────────────────────

export async function listPendingApprovals(actor: AuthenticatedUser, query: ApprovalListQuery) {
  if (tierOf(actor.role) < TIER.bishop) {
    throw forbidden("Your role does not review leadership applications.");
  }

  const where = pendingApprovalsWhere(actor);
  const empty = { data: [], total: 0, page: query.page, limit: query.limit };
  if (!where) return empty;

  const [data, total] = await Promise.all([
    prisma.leaderApproval.findMany({
      where,
      select: APPROVAL_SELECT,
      orderBy: { createdAt: "asc" },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.leaderApproval.count({ where }),
  ]);

  return { data, total, page: query.page, limit: query.limit };
}

/**
 * The queue this actor is allowed to see, or null when they can see nothing.
 *
 * Returning null rather than an unfiltered query matters: the old SQL fell back
 * to `COALESCE($1, 0) >= <tier CASE>` with the actor's tier, and applied no
 * geographic predicate at all.
 */
function pendingApprovalsWhere(actor: AuthenticatedUser): Prisma.LeaderApprovalWhereInput | null {
  const global = hasGlobalReach(actor);

  // Mission leaders review only missionary applications from their own mission.
  if (isMissionLeader(actor.role) && !global) {
    const missionId = missionScopeOf(actor);
    if (!missionId) return null;
    return { status: "pending", declaredRole: "missionary", applicant: { missionId } };
  }

  const reviewable = reviewableRoles(actor.role);

  if (global) {
    // Area authority and above see everything pending, missionary applications
    // included. The old query filtered `declared_role != 'missionary'` for every
    // reviewer, so global admins could approve applications they could not list.
    if (reviewable.length === 0) return null;
    return { status: "pending", declaredRole: { in: reviewable } };
  }

  const unit = unitScopeOf(actor);
  if (!unit) return null;

  // A stake or ward leader is not the right reviewer for a missionary, whose
  // mission president owns that decision.
  const roles = reviewable.filter((role) => role !== "missionary");
  if (roles.length === 0) return null;

  return { status: "pending", declaredRole: { in: roles }, applicant: unit };
}

// ─── Review ─────────────────────────────────────────────────────────────────

interface ApprovalForReview {
  id: string;
  declaredRole: LeadershipRole;
  applicant: {
    id: string;
    role: LeadershipRole;
    stakeId: string | null;
    districtId: string | null;
    missionId: string | null;
  };
}

async function loadPendingApproval(id: string): Promise<ApprovalForReview> {
  const approval = await prisma.leaderApproval.findFirst({
    where: { id, status: "pending" },
    select: {
      id: true,
      declaredRole: true,
      applicant: {
        select: {
          id: true,
          role: true,
          stakeId: true,
          districtId: true,
          missionId: true,
        },
      },
    },
  });
  if (!approval) throw notFound("Approval not found");
  return approval;
}

/**
 * Whether `actor` may decide this application.
 *
 * Strict seniority, no self-review, and a shared unit or mission unless the
 * actor is an area authority or above.
 */
function assertCanReview(actor: AuthenticatedUser, approval: ApprovalForReview): void {
  if (approval.applicant.id === actor.id) {
    throw forbidden("You cannot review your own application.");
  }

  if (!outranks(actor.role, approval.declaredRole)) {
    throw forbidden("Reviewing this position requires a more senior leader.");
  }

  if (hasGlobalReach(actor)) return;

  if (approval.declaredRole === "missionary") {
    if (!isMissionLeader(actor.role)) {
      throw forbidden("Only a mission president can review missionary accounts.");
    }
    const missionId = missionScopeOf(actor);
    if (!missionId || approval.applicant.missionId !== missionId) {
      throw forbidden("You can only review missionaries from your own mission.");
    }
    return;
  }

  const sameStake = Boolean(actor.stakeId) && actor.stakeId === approval.applicant.stakeId;
  const sameDistrict = Boolean(actor.districtId) && actor.districtId === approval.applicant.districtId;
  if (!sameStake && !sameDistrict) {
    throw forbidden("You can only review applications from your own stake or district.");
  }
}

export async function approveApplication(
  actor: AuthenticatedUser,
  approvalId: string,
): Promise<{ message: string }> {
  const approval = await loadPendingApproval(approvalId);
  assertCanReview(actor, approval);

  const reviewedAt = new Date();

  await prisma.$transaction(async (tx) => {
    // `status: "pending"` in the filter makes a concurrent second review a
    // no-op rather than a double approval.
    const claimed = await tx.leaderApproval.updateMany({
      where: { id: approval.id, status: "pending" },
      data: { status: "approved", reviewerId: actor.id, reviewedAt },
    });
    if (claimed.count === 0) throw conflict("This application has already been reviewed.");

    await tx.user.update({
      where: { id: approval.applicant.id },
      data: { isApproved: true, approvedById: actor.id, approvedAt: reviewedAt },
    });

    // A plain member's pool membership is approved along with their account.
    if (approval.applicant.role === "ysa_member") {
      if (approval.applicant.stakeId) {
        await tx.stakePoolMember.updateMany({
          where: { userId: approval.applicant.id, stakeId: approval.applicant.stakeId },
          data: { approved: true, approvedAt: reviewedAt, addedById: actor.id },
        });
      } else if (approval.applicant.districtId) {
        // District pools were unreachable before: the old column was a stake
        // foreign key that the code also filled with district ids.
        await tx.stakePoolMember.updateMany({
          where: { userId: approval.applicant.id, districtId: approval.applicant.districtId },
          data: { approved: true, approvedAt: reviewedAt, addedById: actor.id },
        });
      }
    }
  });

  logger.info("leadership application approved", {
    approvalId: approval.id,
    applicantId: approval.applicant.id,
    declaredRole: approval.declaredRole,
    reviewerId: actor.id,
  });

  // INTEGRATION: notify the applicant that their account has been approved.
  // The notification feature owns delivery; this feature must not import it.

  return { message: "Leader account approved" };
}

export async function rejectApplication(
  actor: AuthenticatedUser,
  approvalId: string,
  input: RejectApprovalInput,
): Promise<{ message: string }> {
  const approval = await loadPendingApproval(approvalId);
  assertCanReview(actor, approval);

  const claimed = await prisma.leaderApproval.updateMany({
    where: { id: approval.id, status: "pending" },
    data: {
      status: "rejected",
      reviewerId: actor.id,
      reviewedAt: new Date(),
      notes: input.notes ?? null,
    },
  });
  if (claimed.count === 0) throw conflict("This application has already been reviewed.");

  logger.info("leadership application rejected", {
    approvalId: approval.id,
    applicantId: approval.applicant.id,
    declaredRole: approval.declaredRole,
    reviewerId: actor.id,
  });

  // INTEGRATION: notify the applicant that their application was declined.

  return { message: "Application rejected" };
}

// ─── YSA pool ───────────────────────────────────────────────────────────────

/**
 * Approve a member into the actor's own stake or district pool.
 *
 * The old handler ran an UPDATE keyed on `req.user.stake_id` and returned
 * "Member approved" regardless of how many rows changed, so a leader with no
 * stake, or a target in another stake, got a success message for nothing.
 */
export async function approvePoolMember(
  actor: AuthenticatedUser,
  userId: string,
): Promise<{ message: string }> {
  if (userId === actor.id) {
    throw forbidden("You cannot approve your own pool membership.");
  }

  const unit = actor.stakeId
    ? ({ stakeId: actor.stakeId } as const)
    : actor.districtId
      ? ({ districtId: actor.districtId } as const)
      : null;

  if (!unit) {
    throw forbidden("Your account is not assigned to a stake or district.");
  }

  const approvedAt = new Date();
  const updated = await prisma.stakePoolMember.updateMany({
    where: { userId, ...unit },
    data: { approved: true, approvedAt, addedById: actor.id },
  });

  if (updated.count === 0) {
    throw notFound("That member has no pending pool membership in your unit.");
  }

  logger.info("pool membership approved", { userId, actorId: actor.id, ...unit });

  // INTEGRATION: notify the member that they now appear in the unit pool.

  return { message: "Member approved for stake pool" };
}
