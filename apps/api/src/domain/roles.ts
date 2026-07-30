import { LeadershipRole } from "../generated/prisma/enums";

/**
 * The single source of truth for role authority.
 *
 * This replaces three separate and mutually inconsistent tables that the old
 * backend carried at once:
 *
 *   - utils/accessControl.js  ROLE_TIER   (13 importers, the de facto authority)
 *   - config/hierarchy.js     ROLE_LEVEL  (1 importer, different values)
 *   - utils/hierarchy.js      ROLE_LEVEL  (1 importer, different again)
 *
 * ROLE_TIER omitted `district_presidency` and `ysa_adviser` completely, so
 * guards written as `ROLE_TIER[role] < 4` evaluated `undefined < 4`, which is
 * false, and therefore let those roles straight through. Typing this as a
 * complete Record over LeadershipRole makes that class of bug a compile error:
 * add a value to the Prisma enum and this file stops building until it is
 * given a tier.
 *
 * Base values follow the old ROLE_TIER because it governed almost all real
 * traffic. Note one deliberate divergence retained from ROLE_TIER: mission
 * presidents sit at 5 alongside the coordinating council, whereas
 * config/hierarchy.js placed them at 6 as peers of area authorities. Worth
 * confirming against how the Church hierarchy should actually behave.
 */
export const ROLE_TIER: Record<LeadershipRole, number> = {
  ysa_member: 1,
  missionary: 1,
  ysa_rep: 2,
  ysa_adviser: 2,
  ysa_couple_adviser: 2,
  bishop: 3,
  district_presidency: 3,
  stake_presidency: 4,
  coordinating_council: 5,
  mission_president: 5,
  mission_president_wife: 5,
  area_authority: 6,
  area_presidency: 7,
  general_authority: 8,
  apostle: 9,
  first_presidency: 10,
  it_support: 11,
};

/** Senior roles whose profiles are hidden from anyone below their tier. */
export const HIDDEN_ROLES: ReadonlySet<LeadershipRole> = new Set<LeadershipRole>([
  "area_authority",
  "area_presidency",
  "general_authority",
  "apostle",
  "first_presidency",
]);

/**
 * Roles that a leader must approve before the account gains its privileges.
 *
 * Every role except plain membership is listed. The old table omitted
 * `it_support`, `district_presidency` and `ysa_adviser`, which meant anyone
 * could POST /auth/register with `role: "it_support"` and be auto-approved into
 * the highest tier in the system.
 */
export const REQUIRES_APPROVAL: ReadonlySet<LeadershipRole> = new Set<LeadershipRole>([
  "missionary",
  "ysa_rep",
  "ysa_adviser",
  "ysa_couple_adviser",
  "bishop",
  "district_presidency",
  "stake_presidency",
  "coordinating_council",
  "mission_president",
  "mission_president_wife",
  "area_authority",
  "area_presidency",
  "general_authority",
  "apostle",
  "first_presidency",
  "it_support",
]);

/**
 * Roles a person may choose for themselves at registration.
 *
 * Registration previously took `role` straight from the request body with no
 * validation whatsoever. Self-selecting a leadership role now only records a
 * claim: REQUIRES_APPROVAL keeps it inert until a qualifying leader approves
 * it. `it_support` is deliberately absent, since it cannot be granted through
 * self-service at all.
 */
export const SELF_ASSIGNABLE_ROLES: ReadonlySet<LeadershipRole> = new Set<LeadershipRole>([
  "ysa_member",
  "missionary",
  "ysa_rep",
  "ysa_adviser",
  "ysa_couple_adviser",
  "bishop",
  "district_presidency",
  "stake_presidency",
  "coordinating_council",
  "mission_president",
  "mission_president_wife",
]);

/** Roles that may only ever be set by an administrator, never self-claimed. */
export const ADMIN_ONLY_ROLES: ReadonlySet<LeadershipRole> = new Set<LeadershipRole>([
  "area_authority",
  "area_presidency",
  "general_authority",
  "apostle",
  "first_presidency",
  "it_support",
]);

export function tierOf(role: LeadershipRole): number {
  return ROLE_TIER[role];
}

export function isHiddenRole(role: LeadershipRole): boolean {
  return HIDDEN_ROLES.has(role);
}

export function requiresLeaderApproval(role: LeadershipRole): boolean {
  return REQUIRES_APPROVAL.has(role);
}

export function isSelfAssignableRole(role: LeadershipRole): boolean {
  return SELF_ASSIGNABLE_ROLES.has(role);
}

/** Narrows arbitrary input to a known role. Use at every trust boundary. */
export function parseRole(value: unknown): LeadershipRole | null {
  if (typeof value !== "string") return null;
  return Object.prototype.hasOwnProperty.call(ROLE_TIER, value) ? (value as LeadershipRole) : null;
}

/**
 * Whether `actor` outranks `target` strictly.
 *
 * Approval and moderation should require strict seniority. The old
 * `approverTier >= ROLE_TIER[declaredRole]` allowed peer approval, so a bishop
 * could approve other bishops' applications and a stake presidency could
 * approve its own tier.
 */
export function outranks(actor: LeadershipRole, target: LeadershipRole): boolean {
  return tierOf(actor) > tierOf(target);
}

export function atLeastTier(role: LeadershipRole, minimum: number): boolean {
  return tierOf(role) >= minimum;
}

export const TIER = {
  member: 1,
  wardLeader: 2,
  bishop: 3,
  stake: 4,
  council: 5,
  area: 6,
  areaPresidency: 7,
  general: 8,
  apostle: 9,
  firstPresidency: 10,
  itSupport: 11,
} as const;
