import { outranks, TIER, tierOf } from "../../domain/roles";
import type { Prisma } from "../../generated/prisma/client";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import type { AuthenticatedUser } from "../../middleware/auth";
import { forbidden, notFound } from "../../middleware/errorHandler";
import type { StakeListQuery, SuspendUserInput, UserListQuery } from "./schemas";

/**
 * Admin dashboard.
 *
 * The old controller built its scope filter as
 * `AND u.stake_id = '${req.user.stake_id}'` and pasted it into six queries. That
 * is string-interpolated SQL taking a value from the request context, and for an
 * admin with no stake it produced `= 'null'`, which Postgres rejects as an
 * invalid uuid: a guaranteed 500. There is no SQL here at all.
 */

/** What slice of the platform an admin may see. */
export type AdminScope = "global" | "council" | "unit";

function scopeOf(actor: AuthenticatedUser): AdminScope {
  const tier = tierOf(actor.role);
  if (tier >= TIER.area) return "global";
  if (tier >= TIER.council) return "council";
  if (tier >= TIER.bishop) return "unit";
  // Unreachable through the router, which enforces a bishop tier floor. Fail
  // closed rather than defaulting to global.
  throw forbidden("Admin access requires a unit leadership calling.");
}

/**
 * The user filter for a scoped admin, or undefined when the actor sees
 * everything.
 *
 * Note the gap this leaves: `council` scope is unfiltered, because `User` has no
 * coordinating-council column, so there is nothing to compare against. That
 * matches the old behaviour rather than silently broadening or narrowing it, and
 * is worth revisiting once users carry a council.
 */
function userScopeOf(actor: AuthenticatedUser): Prisma.UserWhereInput | undefined {
  if (scopeOf(actor) !== "unit") return undefined;

  const clauses: Prisma.UserWhereInput[] = [];
  if (actor.stakeId) clauses.push({ stakeId: actor.stakeId });
  if (actor.districtId) clauses.push({ districtId: actor.districtId });

  if (clauses.length === 0) {
    throw forbidden(
      "Your account is not assigned to a stake or district, so there is no unit to report on.",
    );
  }
  return { OR: clauses };
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

// ─── Dashboard ──────────────────────────────────────────────────────────────

export async function getDashboard(actor: AuthenticatedUser) {
  const scope = scopeOf(actor);
  const userWhere = userScopeOf(actor);

  const now = new Date();
  const onlineSince = new Date(now.getTime() - 5 * 60 * 1000);
  const conversationsSince = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Seven UTC day buckets, oldest first, ending with today.
  const today = startOfUtcDay(now);
  const days = Array.from({ length: 7 }, (_, index) => {
    const from = new Date(today.getTime() - (6 - index) * 24 * 60 * 60 * 1000);
    return { from, to: new Date(from.getTime() + 24 * 60 * 60 * 1000) };
  });

  const [
    usersByRole,
    missionaryTotal,
    mdmEnrolled,
    conversationsTotal,
    groupChats,
    activeStatuses,
    usersPosting,
    pendingApprovals,
    onlineNow,
    messageDays,
  ] = await Promise.all([
    prisma.user.groupBy({
      by: ["role", "status"],
      where: userWhere,
      _count: { _all: true },
    }),
    prisma.user.count({ where: { ...userWhere, role: "missionary" } }),
    prisma.user.count({ where: { ...userWhere, role: "missionary", maas360Enrolled: true } }),
    prisma.conversation.count({
      where: {
        createdAt: { gt: conversationsSince },
        ...(userWhere ? { createdBy: userWhere } : {}),
      },
    }),
    prisma.conversation.count({
      where: {
        createdAt: { gt: conversationsSince },
        isGroup: true,
        ...(userWhere ? { createdBy: userWhere } : {}),
      },
    }),
    prisma.status.count({
      where: { expiresAt: { gt: now }, ...(userWhere ? { user: userWhere } : {}) },
    }),
    prisma.status.groupBy({
      by: ["userId"],
      where: { expiresAt: { gt: now }, ...(userWhere ? { user: userWhere } : {}) },
      _count: { _all: true },
    }),
    prisma.leaderApproval.count({
      where: { status: "pending", ...(userWhere ? { applicant: userWhere } : {}) },
    }),
    prisma.user.count({ where: { ...userWhere, lastSeen: { gt: onlineSince } } }),
    // One grouped query per day. Grouping by a date expression is not something
    // Prisma expresses, and the alternative would be raw SQL.
    Promise.all(
      days.map(async ({ from, to }) => {
        const senders = await prisma.message.groupBy({
          by: ["senderId"],
          where: {
            createdAt: { gte: from, lt: to },
            ...(userWhere ? { sender: userWhere } : {}),
          },
          _count: { _all: true },
        });
        return {
          day: from.toISOString().slice(0, 10),
          messages: senders.reduce((total, row) => total + row._count._all, 0),
          activeUsers: senders.filter((row) => row.senderId !== null).length,
        };
      }),
    ),
  ]);

  return {
    scope,
    overview: {
      onlineNow,
      pendingApprovals,
      activeMissionaries: missionaryTotal,
      // Counts confirmed MDM enrolments only. The old figure counted rows the
      // enrollment service had marked enrolled without contacting MaaS360.
      mdmEnrolled,
      activeStatuses,
      usersPosting: usersPosting.length,
    },
    usersByRole: usersByRole
      .map((row) => ({ role: row.role, status: row.status, count: row._count._all }))
      .sort((a, b) => b.count - a.count),
    messageActivity: messageDays,
    groups: { totalConversations: conversationsTotal, groupChats },
  };
}

// ─── User list ──────────────────────────────────────────────────────────────

const ADMIN_USER_SELECT = {
  id: true,
  fullName: true,
  phoneNumber: true,
  email: true,
  role: true,
  status: true,
  isApproved: true,
  dateOfBirth: true,
  profilePhotoUrl: true,
  missionaryModeActive: true,
  maas360Enrolled: true,
  lastSeen: true,
  createdAt: true,
  stake: { select: { id: true, name: true } },
  district: { select: { id: true, name: true } },
  mission: { select: { id: true, name: true } },
} as const;

export async function listUsers(actor: AuthenticatedUser, query: UserListQuery) {
  const scopeFilter = userScopeOf(actor);

  // The scope is ANDed, never replaced. The old handler used the caller's
  // `stake_id` in place of their own whenever one was supplied, so a bishop who
  // passed `?stake_id=<any stake>` could list that stake's members instead of
  // their own. Passing a stake id can now only narrow within scope.
  const and: Prisma.UserWhereInput[] = [];
  if (scopeFilter) and.push(scopeFilter);
  if (query.search) {
    and.push({
      OR: [
        { fullName: { contains: query.search, mode: "insensitive" } },
        { phoneNumber: { contains: query.search } },
        { email: { contains: query.search, mode: "insensitive" } },
      ],
    });
  }

  const where: Prisma.UserWhereInput = {
    ...(query.role ? { role: query.role } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.stake_id ? { stakeId: query.stake_id } : {}),
    ...(and.length > 0 ? { AND: and } : {}),
  };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: ADMIN_USER_SELECT,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.user.count({ where }),
  ]);

  return { users, total, page: query.page, limit: query.limit };
}

// ─── Suspension ─────────────────────────────────────────────────────────────

/**
 * Suspend or reinstate an account.
 *
 * Adds what the old handler lacked: strict seniority through `outranks` rather
 * than `targetTier >= actorTier` over a table that omitted roles (an unlisted
 * role resolved to tier 0 and was suspendable by anybody), a geographic check so
 * a stake-level admin cannot reach into another stake, and a self-check.
 */
export async function suspendUser(
  actor: AuthenticatedUser,
  targetId: string,
  input: SuspendUserInput,
): Promise<{ message: string }> {
  if (targetId === actor.id) {
    throw forbidden("You cannot change your own account status.");
  }

  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: { id: true, role: true, fullName: true, stakeId: true, districtId: true, status: true },
  });
  if (!target) throw notFound("User not found");

  if (!outranks(actor.role, target.role)) {
    throw forbidden("Cannot suspend a user at your level or above.");
  }

  if (scopeOf(actor) !== "global") {
    const sameStake = Boolean(actor.stakeId) && actor.stakeId === target.stakeId;
    const sameDistrict = Boolean(actor.districtId) && actor.districtId === target.districtId;
    if (!sameStake && !sameDistrict) {
      throw forbidden("You can only manage accounts in your own stake or district.");
    }
  }

  await prisma.user.update({
    where: { id: target.id },
    data: { status: input.suspended ? "suspended" : "active" },
  });

  // The reason is recorded in the log, not on the row: there is no column for
  // it. The old response echoed it back to the caller as though it had been
  // stored.
  logger.warn(input.suspended ? "account suspended" : "account reinstated", {
    targetId: target.id,
    actorId: actor.id,
    reason: input.reason ?? null,
  });

  // INTEGRATION: notify the account owner that their access changed.

  return {
    message: input.suspended ? "Account suspended" : "Account reinstated",
  };
}

// ─── Missionary overview ────────────────────────────────────────────────────

export async function getMissionaryOverview(actor: AuthenticatedUser) {
  const scopeFilter = userScopeOf(actor);

  const missionaries = await prisma.user.findMany({
    where: {
      AND: [
        { OR: [{ role: "missionary" }, { missionaryModeActive: true }] },
        ...(scopeFilter ? [scopeFilter] : []),
      ],
    },
    select: {
      id: true,
      fullName: true,
      phoneNumber: true,
      profilePhotoUrl: true,
      missionaryStartDate: true,
      missionaryEndDate: true,
      maas360Enrolled: true,
      maas360DeviceId: true,
      mission: { select: { id: true, name: true, country: true } },
    },
    orderBy: { missionaryStartDate: "desc" },
  });

  type Missionary = (typeof missionaries)[number];
  const byMission = new Map<string, { mission: string; country: string | null; missionaries: Missionary[] }>();

  for (const person of missionaries) {
    const key = person.mission?.name ?? "Unassigned";
    const bucket = byMission.get(key);
    if (bucket) {
      bucket.missionaries.push(person);
    } else {
      byMission.set(key, {
        mission: key,
        country: person.mission?.country ?? null,
        missionaries: [person],
      });
    }
  }

  return {
    total: missionaries.length,
    mdmEnrolled: missionaries.filter((person) => person.maas360Enrolled).length,
    byMission: [...byMission.values()],
  };
}

// ─── Stakes overview ────────────────────────────────────────────────────────

/**
 * Stakes with their YSA pool figures.
 *
 * The old query INNER JOINed coordinating_councils and areas, so every stake
 * without a council, which is most of them in the current data, was missing from
 * the response entirely. The relations are optional here.
 */
export async function getStakesOverview(query: StakeListQuery) {
  const [stakes, total] = await Promise.all([
    prisma.stake.findMany({
      select: {
        id: true,
        name: true,
        country: true,
        ysaPoolActive: true,
        coordinatingCouncil: {
          select: { id: true, name: true, area: { select: { id: true, name: true } } },
        },
      },
      orderBy: [{ country: "asc" }, { name: "asc" }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.stake.count(),
  ]);

  const stakeIds = stakes.map((stake) => stake.id);

  const [membershipCounts, poolCounts] = await Promise.all([
    prisma.user.groupBy({
      by: ["stakeId", "role"],
      where: { stakeId: { in: stakeIds }, role: { in: ["ysa_member", "missionary"] } },
      _count: { _all: true },
    }),
    prisma.stakePoolMember.groupBy({
      by: ["stakeId"],
      where: { stakeId: { in: stakeIds }, approved: true },
      _count: { _all: true },
    }),
  ]);

  const ysaCounts = new Map<string, number>();
  const missionaryCounts = new Map<string, number>();
  for (const row of membershipCounts) {
    if (!row.stakeId) continue;
    const target = row.role === "ysa_member" ? ysaCounts : missionaryCounts;
    target.set(row.stakeId, (target.get(row.stakeId) ?? 0) + row._count._all);
  }

  const poolMembers = new Map<string, number>();
  for (const row of poolCounts) {
    if (!row.stakeId) continue;
    poolMembers.set(row.stakeId, row._count._all);
  }

  return {
    stakes: stakes.map((stake) => ({
      id: stake.id,
      name: stake.name,
      country: stake.country,
      ysaPoolActive: stake.ysaPoolActive,
      coordinatingCouncil: stake.coordinatingCouncil?.name ?? null,
      area: stake.coordinatingCouncil?.area?.name ?? null,
      ysaCount: ysaCounts.get(stake.id) ?? 0,
      poolMembers: poolMembers.get(stake.id) ?? 0,
      missionaries: missionaryCounts.get(stake.id) ?? 0,
    })),
    total,
    page: query.page,
    limit: query.limit,
  };
}
