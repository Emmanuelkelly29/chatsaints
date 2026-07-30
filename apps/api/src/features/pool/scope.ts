import { TIER, tierOf } from "../../domain/roles";
import type { AuthenticatedUser } from "../../middleware/auth";
import { badRequest, forbidden } from "../../middleware/errorHandler";
import { canAccessStakePool } from "./visibility";

/**
 * Which unit a caller is allowed to act on.
 *
 * Every write endpoint in the old ysaPool.js checked the caller's *tier* and
 * then applied the change to whatever unit id was in the URL or body. A
 * stake-tier leader could flip YSA pool visibility for any stake or district in
 * the world, insert an arbitrary user into an arbitrary stake's pool, and
 * approve or delete pool memberships globally by row id. The tier check was
 * real; the ownership check did not exist.
 *
 * Nothing here trusts a caller-supplied unit id on its own: it is always
 * checked against the unit the caller actually belongs to.
 */

export type UnitType = "stake" | "district";

export interface PoolUnit {
  type: UnitType;
  id: string;
}

/** A membership row as stored: exactly one of the two ids is set. */
export interface MembershipUnitColumns {
  stakeId: string | null;
  districtId: string | null;
}

/**
 * Area-level leadership and IT support act across unit boundaries.
 *
 * Equivalent to the old `hasGlobalPoolControl` (it_support or tier >= 6);
 * it_support is tier 11 in the unified table, so it needs no special case.
 */
export function hasGlobalPoolControl(user: Pick<AuthenticatedUser, "role">): boolean {
  return tierOf(user.role) >= TIER.area;
}

/** The stake or district the caller belongs to. A person has at most one. */
export function homeUnitOf(
  user: Pick<AuthenticatedUser, "stakeId" | "districtId">,
): PoolUnit | null {
  if (user.stakeId) return { type: "stake", id: user.stakeId };
  if (user.districtId) return { type: "district", id: user.districtId };
  return null;
}

/** Both units the caller may administer. Normally one, never more. */
export function ownUnitsOf(user: Pick<AuthenticatedUser, "stakeId" | "districtId">): PoolUnit[] {
  const units: PoolUnit[] = [];
  if (user.stakeId) units.push({ type: "stake", id: user.stakeId });
  if (user.districtId) units.push({ type: "district", id: user.districtId });
  return units;
}

/** Whether the caller administers `unit`. */
export function leadsUnit(
  user: Pick<AuthenticatedUser, "role" | "stakeId" | "districtId">,
  unit: PoolUnit,
): boolean {
  if (hasGlobalPoolControl(user)) return true;
  return unit.type === "stake" ? user.stakeId === unit.id : user.districtId === unit.id;
}

export function assertLeadsUnit(
  user: Pick<AuthenticatedUser, "role" | "stakeId" | "districtId">,
  unit: PoolUnit,
): void {
  if (!leadsUnit(user, unit)) {
    throw forbidden(`You do not lead that ${unit.type}.`);
  }
}

/**
 * Who may open or close a pool.
 *
 * A stake pool needs stake-presidency tier over that same stake. A district
 * pool needs its own district presidency, which sits at tier 3 in the unified
 * table: requiring tier 4 here would lock district presidents out of their own
 * district. The old code required tier >= 4 for both, but
 * `district_presidency` was missing from its tier table, so the comparison
 * `undefined < 4` was false and district presidents passed anyway. This states
 * the intended rule instead of relying on that accident.
 */
export function canSetPoolVisibility(
  user: Pick<AuthenticatedUser, "role" | "stakeId" | "districtId">,
  unit: PoolUnit,
): boolean {
  if (hasGlobalPoolControl(user)) return true;
  if (!leadsUnit(user, unit)) return false;
  if (unit.type === "stake") return tierOf(user.role) >= TIER.stake;
  return user.role === "district_presidency" || tierOf(user.role) >= TIER.stake;
}

export function assertCanSetPoolVisibility(
  user: Pick<AuthenticatedUser, "role" | "stakeId" | "districtId">,
  unit: PoolUnit,
): void {
  if (!canSetPoolVisibility(user, unit)) {
    throw forbidden(`Only the presiding leadership of that ${unit.type} can change its pool.`);
  }
}

/**
 * The unit a membership row belongs to.
 *
 * The old table had a single `stake_id` column with a foreign key to `stakes`
 * that the code also filled with district ids ("Works for both stake IDs and
 * district IDs"). Reads happened to work; an insert of a district id would have
 * violated the constraint, so district pools could never gain a member. The row
 * now carries `stakeId` or `districtId`, with a CHECK constraint enforcing that
 * exactly one is set.
 */
export function unitOfMembership(row: MembershipUnitColumns): PoolUnit {
  if (row.stakeId) return { type: "stake", id: row.stakeId };
  if (row.districtId) return { type: "district", id: row.districtId };
  // Unreachable while the CHECK constraint holds.
  throw badRequest("That pool membership belongs to no unit.");
}

/** Membership filter for one unit, as a Prisma where fragment. */
export function membershipUnitFilter(unit: PoolUnit): MembershipUnitColumns {
  return unit.type === "stake"
    ? { stakeId: unit.id, districtId: null }
    : { stakeId: null, districtId: unit.id };
}

/**
 * Guard for every YSA pool browsing route. Missionary accounts are limited to
 * the mission directory.
 */
export function assertCanBrowsePool(user: AuthenticatedUser): void {
  if (!canAccessStakePool(user)) {
    throw forbidden("Missionary accounts browse the mission directory, not the YSA pool.");
  }
}
