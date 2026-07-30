import type { Prisma } from "../../generated/prisma/client";
import type { AnnouncementScope, LeadershipRole } from "../../generated/prisma/enums";
import { prisma } from "../../lib/prisma";
import type { AuthenticatedUser } from "../../middleware/auth";
import { badRequest, forbidden } from "../../middleware/errorHandler";

/**
 * Who may send an announcement, how far it reaches, and which roles receive it.
 *
 * Scope is derived from the sender's role and geography and is never accepted
 * from the request body. Audience (which roles within that scope) is the only
 * part the sender chooses.
 */

// ─── Audience ───────────────────────────────────────────────────────────────

export const AUDIENCE_KEYS = [
  "all",
  "ysa_only",
  "missionaries_only",
  "ysa_and_missionaries",
  "ward_leaders",
  "stake_district_presidents",
  "all_leaders",
] as const;

export type AudienceKey = (typeof AUDIENCE_KEYS)[number];

/**
 * Audience key to receiving roles.
 *
 * Typed as a complete Record over every key except "all", so adding an audience
 * key to AUDIENCE_KEYS stops this file compiling until it is given a role list.
 * The old version was a plain object indexed with `AUDIENCE_ROLE_MAP[a] || []`,
 * where a typo produced "no roles" and therefore silently sent to everybody.
 */
const AUDIENCE_ROLES: Record<Exclude<AudienceKey, "all">, readonly LeadershipRole[]> = {
  ysa_only: ["ysa_member"],
  missionaries_only: ["missionary"],
  ysa_and_missionaries: ["ysa_member", "missionary"],
  ward_leaders: ["bishop", "ysa_rep", "ysa_adviser", "ysa_couple_adviser"],
  stake_district_presidents: ["stake_presidency", "district_presidency"],
  all_leaders: [
    "bishop",
    "stake_presidency",
    "district_presidency",
    "coordinating_council",
    "area_authority",
    "mission_president",
    "mission_president_wife",
    "area_presidency",
    "general_authority",
    "apostle",
    "first_presidency",
    "ysa_rep",
    "ysa_adviser",
    "ysa_couple_adviser",
    "it_support",
  ],
};

/**
 * Roles an audience selection resolves to, or null for "no role filter".
 *
 * The old implementation built `AND role = ANY(ARRAY['a','b'])` by string
 * concatenation of the audience values. Nothing validated them before they were
 * interpolated, so the injection was only prevented by the VALID_AUDIENCES
 * filter happening to run first. There is no SQL here to inject into.
 */
export function rolesForAudiences(audiences: readonly AudienceKey[]): LeadershipRole[] | null {
  if (audiences.length === 0 || audiences.includes("all")) return null;

  const roles = new Set<LeadershipRole>();
  for (const audience of audiences) {
    if (audience === "all") continue;
    for (const role of AUDIENCE_ROLES[audience]) roles.add(role);
  }
  return roles.size === 0 ? null : [...roles];
}

// ─── Sender scope ───────────────────────────────────────────────────────────

/**
 * Roles permitted to send an announcement, and how far their announcement
 * reaches.
 *
 * Differences from the old LEADER_ROLES set:
 *
 *  - `it_support` is removed. It sat in the global-sender list, which meant the
 *    highest-tier self-registerable role in the old system could push a
 *    notification to every account on the platform. IT support is a technical
 *    role; broadcasting to the membership is not a technical function.
 *  - `area_authority` now resolves to the `area` scope instead of being quietly
 *    downgraded to the sender's own stake. The AnnouncementScope enum has an
 *    `area` member and nothing ever used it.
 *
 * Retained from the old behaviour, and worth a decision from someone who knows
 * the hierarchy: a bishop's announcement reaches their whole stake rather than
 * their ward, and a coordinating council reaches only its own stake rather than
 * every stake in the council. The enum has no ward or council scope to express
 * either properly.
 */
export const ANNOUNCEMENT_SENDER_ROLES = [
  "first_presidency",
  "apostle",
  "general_authority",
  "area_presidency",
  "area_authority",
  "mission_president",
  "mission_president_wife",
  "coordinating_council",
  "stake_presidency",
  "district_presidency",
  "bishop",
  "ysa_rep",
  "ysa_adviser",
] as const satisfies readonly LeadershipRole[];

export type SenderRole = (typeof ANNOUNCEMENT_SENDER_ROLES)[number];

const SENDER_SCOPES: Record<SenderRole, AnnouncementScope> = {
  first_presidency: "global",
  apostle: "global",
  general_authority: "global",
  area_presidency: "global",
  area_authority: "area",
  mission_president: "mission",
  mission_president_wife: "mission",
  coordinating_council: "stake",
  stake_presidency: "stake",
  district_presidency: "district",
  bishop: "stake",
  ysa_rep: "stake",
  ysa_adviser: "stake",
};

function isSenderRole(role: LeadershipRole): role is SenderRole {
  return Object.prototype.hasOwnProperty.call(SENDER_SCOPES, role);
}

export interface ResolvedScope {
  scope: AnnouncementScope;
  scopeId: string | null;
}

/** The area a user belongs to, via their stake, district or mission. */
async function areaIdOf(user: AuthenticatedUser): Promise<string | null> {
  if (user.stakeId) {
    const stake = await prisma.stake.findUnique({
      where: { id: user.stakeId },
      select: { coordinatingCouncil: { select: { areaId: true } } },
    });
    const areaId = stake?.coordinatingCouncil?.areaId;
    if (areaId) return areaId;
  }

  if (user.districtId) {
    const district = await prisma.district.findUnique({
      where: { id: user.districtId },
      select: { coordinatingCouncil: { select: { areaId: true } } },
    });
    const areaId = district?.coordinatingCouncil?.areaId;
    if (areaId) return areaId;
  }

  const missionId = user.missionPresidentMissionId ?? user.missionId;
  if (missionId) {
    const mission = await prisma.mission.findUnique({
      where: { id: missionId },
      select: { areaId: true },
    });
    if (mission?.areaId) return mission.areaId;
  }

  return null;
}

/**
 * Resolves the sender's authority, or refuses.
 *
 * The old version returned `{ scope: 'stake', scope_id: undefined }` when a
 * stake-scoped leader had no stake on their account. The announcement was then
 * written to the database, delivered to nobody, and reported back as a success
 * with `recipient_count: 0`. A missing scope id is a configuration error and is
 * now reported as one.
 */
export async function resolveSenderScope(user: AuthenticatedUser): Promise<ResolvedScope> {
  if (!isSenderRole(user.role)) {
    throw forbidden("Your role cannot send announcements.");
  }

  const scope = SENDER_SCOPES[user.role];

  switch (scope) {
    case "global":
      return { scope, scopeId: null };

    case "area": {
      const areaId = await areaIdOf(user);
      if (!areaId) {
        throw badRequest(
          "Your account is not linked to an area. Ask for your stake, district or mission to be assigned to one first.",
        );
      }
      return { scope, scopeId: areaId };
    }

    case "mission": {
      const missionId = user.missionPresidentMissionId ?? user.missionId;
      if (!missionId) throw badRequest("Your account is not linked to a mission.");
      return { scope, scopeId: missionId };
    }

    case "stake": {
      if (!user.stakeId) throw badRequest("Your account is not linked to a stake.");
      return { scope, scopeId: user.stakeId };
    }

    case "district": {
      if (!user.districtId) throw badRequest("Your account is not linked to a district.");
      return { scope, scopeId: user.districtId };
    }
  }
}

/** Translates a resolved scope into a recipient filter. */
export function scopeFilter(scope: AnnouncementScope, scopeId: string | null): Prisma.UserWhereInput {
  switch (scope) {
    case "global":
      return {};

    case "area":
      if (!scopeId) return { id: { in: [] } };
      return {
        OR: [
          { stake: { coordinatingCouncil: { areaId: scopeId } } },
          { district: { coordinatingCouncil: { areaId: scopeId } } },
          { mission: { areaId: scopeId } },
        ],
      };

    case "mission":
      if (!scopeId) return { id: { in: [] } };
      return {
        OR: [{ missionId: scopeId }, { missionPresidentMissionId: scopeId }],
      };

    case "stake":
      if (!scopeId) return { id: { in: [] } };
      return { stakeId: scopeId };

    case "district":
      if (!scopeId) return { id: { in: [] } };
      return { districtId: scopeId };
  }
}
