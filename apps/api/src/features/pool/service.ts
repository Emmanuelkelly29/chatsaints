import type { Prisma } from "../../generated/prisma/client";
import type { LeadershipRole } from "../../generated/prisma/enums";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import type { AuthenticatedUser } from "../../middleware/auth";
import { badRequest, conflict, forbidden, notFound } from "../../middleware/errorHandler";
import { ageLabelOf, dateOfBirthWindow, type AgeLabel, type AgeRange } from "./ages";
import {
  compareByPlace,
  resolveContinent,
  UNIT_SELECT,
  type Continent,
  type UnitRow,
} from "./geography";
import {
  assertCanSetPoolVisibility,
  assertLeadsUnit,
  canSetPoolVisibility,
  hasGlobalPoolControl,
  homeUnitOf,
  leadsUnit,
  membershipUnitFilter,
  ownUnitsOf,
  unitOfMembership,
  type PoolUnit,
  type UnitType,
} from "./scope";
import { canViewProfile, visibleMissionIds, type ProfileParty } from "./visibility";

/**
 * YSA pool reads and writes.
 *
 * Two things changed structurally in this port:
 *
 *  1. A membership belongs to a stake *or* a district. The old table had one
 *     `stake_id` column, foreign-keyed to `stakes`, that the code also filled
 *     with district ids. Reads worked by accident; an insert of a district id
 *     would have violated the foreign key, so district pools could never gain a
 *     member. Every query below is explicit about which column it means.
 *
 *  2. Every write is scoped to a unit the caller actually leads. Previously the
 *     tier check and the target unit were unrelated, so any stake-tier leader
 *     could administer any unit on earth.
 */

// ─── Shared shapes ──────────────────────────────────────────────────────────

const DIRECTORY_USER_SELECT = {
  id: true,
  fullName: true,
  profilePhotoUrl: true,
  role: true,
  gender: true,
  bio: true,
  dateOfBirth: true,
  // Loaded so hidden senior leaders can be filtered out per caller.
  missionId: true,
  missionPresidentMissionId: true,
  missionaryModeActive: true,
} as const;

interface DirectoryUserRow extends ProfileParty {
  fullName: string;
  profilePhotoUrl: string | null;
  gender: string | null;
  bio: string | null;
  dateOfBirth: Date | null;
}

/** A person as returned by any directory endpoint. */
export interface DirectoryMember {
  id: string;
  fullName: string;
  profilePhotoUrl: string | null;
  role: LeadershipRole;
  gender: string | null;
  bio: string | null;
  ageRange: AgeLabel | null;
  unitType: UnitType | "mission" | null;
  unitId: string | null;
  unitName: string | null;
  country: string | null;
  continent: string | null;
  areaName: string | null;
}

/** A stake or district, with its pool state. */
export interface PoolUnitState {
  /** `"mission"` appears only in the missionary directory, which is not a pool. */
  unitType: UnitType | "mission";
  id: string;
  name: string;
  country: string | null;
  continent: string | null;
  areaName: string | null;
  ysaPoolActive: boolean;
}

/** A unit as returned by any directory endpoint. */
export interface DirectoryUnit extends PoolUnitState {
  memberCount: number;
}

interface UnitPlace {
  name: string;
  country: string | null;
  continent: string | null;
  areaName: string | null;
}

function placeOf(unit: UnitRow): UnitPlace {
  const area = unit.coordinatingCouncil?.area ?? null;
  return {
    name: unit.name,
    country: unit.country,
    continent: resolveContinent(unit),
    areaName: area?.name ?? null,
  };
}

function toDirectoryMember(
  person: DirectoryUserRow,
  unit: { type: UnitType | "mission"; id: string; place: UnitPlace } | null,
): DirectoryMember {
  return {
    id: person.id,
    fullName: person.fullName,
    profilePhotoUrl: person.profilePhotoUrl,
    role: person.role,
    gender: person.gender,
    bio: person.bio,
    ageRange: ageLabelOf(person.dateOfBirth),
    unitType: unit?.type ?? null,
    unitId: unit?.id ?? null,
    unitName: unit?.place.name ?? null,
    country: unit?.place.country ?? null,
    continent: unit?.place.continent ?? null,
    areaName: unit?.place.areaName ?? null,
  };
}

function compareMembers(left: DirectoryMember, right: DirectoryMember): number {
  return compareByPlace(
    { continent: left.continent, country: left.country, name: left.fullName },
    { continent: right.continent, country: right.country, name: right.fullName },
  );
}

/** Only people who are active and have not opted out of the directory. */
const VISIBLE_IN_DIRECTORY: Prisma.UserWhereInput = {
  status: "active",
  profileHidden: false,
  directoryVisible: true,
};

export interface DirectoryFilters {
  ageRanges?: AgeRange[] | undefined;
  gender?: "male" | "female" | undefined;
}

/**
 * Directory filters as Prisma arguments.
 *
 * The gender filter used to be built as `AND LOWER(u.gender) = '${value}'`. The
 * value was whitelisted, so it was not exploitable, but the statement was still
 * assembled by string interpolation. Age bands were four hand-written
 * `EXTRACT(YEAR FROM AGE(...))` fragments; they are date windows now.
 */
function directoryMemberWhere(filters: DirectoryFilters): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = { ...VISIBLE_IN_DIRECTORY };

  if (filters.ageRanges && filters.ageRanges.length > 0) {
    const now = new Date();
    where.OR = filters.ageRanges.map((range) => ({ dateOfBirth: dateOfBirthWindow(range, now) }));
  }
  if (filters.gender) {
    where.gender = { equals: filters.gender, mode: "insensitive" };
  }

  return where;
}

// ─── Unit reads ─────────────────────────────────────────────────────────────

async function readStakes(where: Prisma.StakeWhereInput): Promise<UnitRow[]> {
  return prisma.stake.findMany({ where, select: UNIT_SELECT });
}

async function readDistricts(where: Prisma.DistrictWhereInput): Promise<UnitRow[]> {
  return prisma.district.findMany({ where, select: UNIT_SELECT });
}

/**
 * The units a caller may administer, as query filters.
 *
 * `null` means "no unit at all", which is not the same as `{}`: an empty filter
 * would match every row in the table. The old code passed
 * `[req.user.stake_id || null]` into `WHERE spm.stake_id = $1`, which matched
 * nothing for a leader without a stake, but the same pattern applied to an
 * UPDATE would have been a global write.
 */
function ownUnitFilters(user: AuthenticatedUser): {
  stakes: Prisma.StakeWhereInput | null;
  districts: Prisma.DistrictWhereInput | null;
} {
  if (hasGlobalPoolControl(user)) return { stakes: {}, districts: {} };
  return {
    stakes: user.stakeId ? { id: user.stakeId } : null,
    districts: user.districtId ? { id: user.districtId } : null,
  };
}

/** Resolves an id that may name either a stake or a district. */
async function resolveUnit(unitId: string): Promise<{ unit: PoolUnit; row: UnitRow } | null> {
  const [stake, district] = await Promise.all([
    prisma.stake.findUnique({ where: { id: unitId }, select: UNIT_SELECT }),
    prisma.district.findUnique({ where: { id: unitId }, select: UNIT_SELECT }),
  ]);
  if (stake) return { unit: { type: "stake", id: stake.id }, row: stake };
  if (district) return { unit: { type: "district", id: district.id }, row: district };
  return null;
}

// ─── Approved-member counts ─────────────────────────────────────────────────

interface UnitCounts {
  stakes: Map<string, number>;
  districts: Map<string, number>;
}

/**
 * Approved pool members per unit, counted in the database.
 *
 * `@@unique([userId, stakeId])` and `@@unique([userId, districtId])` mean one row
 * per person per unit, so a row count is a distinct-person count.
 */
async function countApprovedMembers(
  memberWhere: Prisma.UserWhereInput,
  excludeUserId: string,
): Promise<UnitCounts> {
  const base: Prisma.StakePoolMemberWhereInput = {
    approved: true,
    userId: { not: excludeUserId },
    user: memberWhere,
  };

  const [stakeGroups, districtGroups] = await Promise.all([
    prisma.stakePoolMember.groupBy({
      by: ["stakeId"],
      where: { ...base, stakeId: { not: null } },
      _count: { _all: true },
    }),
    prisma.stakePoolMember.groupBy({
      by: ["districtId"],
      where: { ...base, districtId: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const stakes = new Map<string, number>();
  for (const group of stakeGroups) {
    if (group.stakeId) stakes.set(group.stakeId, group._count._all);
  }
  const districts = new Map<string, number>();
  for (const group of districtGroups) {
    if (group.districtId) districts.set(group.districtId, group._count._all);
  }

  return { stakes, districts };
}

function toPoolUnitState(unitType: UnitType | "mission", unit: UnitRow): PoolUnitState {
  const place = placeOf(unit);
  return {
    unitType,
    id: unit.id,
    name: place.name,
    country: place.country,
    continent: place.continent,
    areaName: place.areaName,
    ysaPoolActive: unit.ysaPoolActive,
  };
}

function toDirectoryUnit(
  unitType: UnitType | "mission",
  unit: UnitRow,
  memberCount: number,
): DirectoryUnit {
  return { ...toPoolUnitState(unitType, unit), memberCount };
}

// ─── Leader view: GET /members ──────────────────────────────────────────────

export interface PoolMembershipRow {
  id: string;
  userId: string;
  unitType: UnitType;
  unitId: string;
  unitName: string | null;
  unitCountry: string | null;
  approved: boolean;
  approvedAt: Date | null;
  createdAt: Date;
  fullName: string;
  phoneNumber: string;
  email: string | null;
  profilePhotoUrl: string | null;
  role: LeadershipRole;
  addedByName: string | null;
}

export interface SkippedUnit {
  unitType: UnitType;
  id: string;
  name: string;
  country: string | null;
  unitContinent: string | null;
  areaContinent: string | null;
}

export interface PoolAdminView {
  data: PoolMembershipRow[];
  stakes: PoolUnitState[];
  districts: PoolUnitState[];
  skippedUnits: SkippedUnit[];
}

/** Memberships in the units the caller leads, or all of them for global control. */
function membershipScopeWhere(user: AuthenticatedUser): Prisma.StakePoolMemberWhereInput | null {
  if (hasGlobalPoolControl(user)) return {};
  const units = ownUnitsOf(user);
  if (units.length === 0) return null;
  return { OR: units.map(membershipUnitFilter) };
}

export async function poolAdminView(
  user: AuthenticatedUser,
  includeMembers: boolean,
): Promise<PoolAdminView> {
  const scope = membershipScopeWhere(user);

  const memberships =
    includeMembers && scope !== null
      ? await prisma.stakePoolMember.findMany({
          where: scope,
          orderBy: [{ approved: "asc" }, { createdAt: "desc" }],
          select: {
            id: true,
            userId: true,
            stakeId: true,
            districtId: true,
            approved: true,
            approvedAt: true,
            createdAt: true,
            user: {
              select: {
                fullName: true,
                phoneNumber: true,
                email: true,
                profilePhotoUrl: true,
                role: true,
              },
            },
            stake: { select: { name: true, country: true } },
            district: { select: { name: true, country: true } },
            addedBy: { select: { fullName: true } },
          },
        })
      : [];

  const data: PoolMembershipRow[] = memberships.map((row) => {
    const unit = unitOfMembership(row);
    const place = unit.type === "stake" ? row.stake : row.district;
    return {
      id: row.id,
      userId: row.userId,
      unitType: unit.type,
      unitId: unit.id,
      unitName: place?.name ?? null,
      unitCountry: place?.country ?? null,
      approved: row.approved,
      approvedAt: row.approvedAt,
      createdAt: row.createdAt,
      fullName: row.user.fullName,
      phoneNumber: row.user.phoneNumber,
      email: row.user.email,
      profilePhotoUrl: row.user.profilePhotoUrl,
      role: row.user.role,
      addedByName: row.addedBy?.fullName ?? null,
    };
  });

  const filters = ownUnitFilters(user);
  const [stakeRows, districtRows] = await Promise.all([
    filters.stakes ? readStakes(filters.stakes) : Promise.resolve<UnitRow[]>([]),
    filters.districts ? readDistricts(filters.districts) : Promise.resolve<UnitRow[]>([]),
  ]);

  const skippedUnits: SkippedUnit[] = [];

  const placeUnits = (unitType: UnitType, rows: UnitRow[]): PoolUnitState[] => {
    const placed: PoolUnitState[] = [];
    for (const row of rows) {
      const unit = toPoolUnitState(unitType, row);
      if (unit.continent === null) {
        skippedUnits.push({
          unitType,
          id: row.id,
          name: row.name,
          country: row.country,
          unitContinent: row.continent,
          areaContinent: row.coordinatingCouncil?.area?.continent ?? null,
        });
        continue;
      }
      placed.push(unit);
    }
    return placed.sort(compareByPlace);
  };

  return {
    data,
    stakes: placeUnits("stake", stakeRows),
    districts: placeUnits("district", districtRows),
    skippedUnits,
  };
}

// ─── Membership moderation ──────────────────────────────────────────────────

const MEMBERSHIP_UNIT_SELECT = {
  id: true,
  userId: true,
  stakeId: true,
  districtId: true,
  approved: true,
  approvedAt: true,
  createdAt: true,
} as const;

/**
 * Loads a membership and proves the caller leads the unit it belongs to.
 *
 * `members/:id/approve` and `members/:id/remove` used to act on a row id with no
 * unit scoping whatsoever, so any leader could approve or delete pool
 * memberships anywhere in the world by guessing or harvesting ids.
 */
async function loadOwnedMembership(user: AuthenticatedUser, membershipId: string) {
  const row = await prisma.stakePoolMember.findUnique({
    where: { id: membershipId },
    select: MEMBERSHIP_UNIT_SELECT,
  });
  if (!row) throw notFound("Pool membership not found");
  assertLeadsUnit(user, unitOfMembership(row));
  return row;
}

export async function approvePoolMember(
  user: AuthenticatedUser,
  membershipId: string,
): Promise<{ id: string; approved: boolean; approvedAt: Date | null }> {
  const row = await loadOwnedMembership(user, membershipId);

  const updated = await prisma.stakePoolMember.update({
    where: { id: row.id },
    data: { approved: true, approvedAt: new Date(), addedById: user.id },
    select: { id: true, approved: true, approvedAt: true },
  });

  logger.info("pool membership approved", {
    membershipId: row.id,
    memberId: row.userId,
    approvedBy: user.id,
  });
  // INTEGRATION: notify the member that their pool request was approved.

  return updated;
}

export async function removePoolMember(
  user: AuthenticatedUser,
  membershipId: string,
): Promise<void> {
  const row = await loadOwnedMembership(user, membershipId);
  await prisma.stakePoolMember.delete({ where: { id: row.id } });
  logger.info("pool membership removed", {
    membershipId: row.id,
    memberId: row.userId,
    removedBy: user.id,
  });
}

/**
 * A leader adds someone to their own pool.
 *
 * The old handler took `userId` and `stakeId` from the body and inserted the
 * pair, so a YSA rep could place any account into any stake's pool. The unit is
 * now either the caller's own or one they demonstrably lead, and the person has
 * to belong to that unit.
 */
export async function addPoolMember(
  user: AuthenticatedUser,
  input: { userId: string; stakeId?: string | undefined; districtId?: string | undefined },
): Promise<{ created: boolean; membership: { id: string; approved: boolean } }> {
  const requested: PoolUnit | null = input.stakeId
    ? { type: "stake", id: input.stakeId }
    : input.districtId
      ? { type: "district", id: input.districtId }
      : homeUnitOf(user);

  if (!requested) {
    throw badRequest("You are not assigned to a stake or district, so name the unit explicitly.");
  }
  assertLeadsUnit(user, requested);

  const target = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, stakeId: true, districtId: true, status: true },
  });
  if (!target) throw notFound("User not found");

  const belongs =
    requested.type === "stake"
      ? target.stakeId === requested.id
      : target.districtId === requested.id;
  if (!belongs) throw badRequest(`That person does not belong to this ${requested.type}.`);

  const columns = membershipUnitFilter(requested);

  const existing = await prisma.stakePoolMember.findFirst({
    where: { userId: target.id, ...columns },
    select: { id: true, approved: true },
  });
  if (existing) return { created: false, membership: existing };

  const membership = await prisma.stakePoolMember.create({
    data: { userId: target.id, ...columns, addedById: user.id, approved: false },
    select: { id: true, approved: true },
  });

  logger.info("pool member added", {
    membershipId: membership.id,
    memberId: target.id,
    unitType: requested.type,
    unitId: requested.id,
    addedBy: user.id,
  });
  // INTEGRATION: notify the member that a leader added them to the pool.

  return { created: true, membership };
}

// ─── Pool visibility ────────────────────────────────────────────────────────

/**
 * Opens or closes one pool. `next === null` toggles.
 *
 * `toggle/:stakeId`, `toggle-district/:districtId` and `open/:stakeId` all
 * checked the caller's tier and then updated whatever id was in the path, so any
 * stake-tier leader could switch YSA pool visibility on for a stake or district
 * anywhere in the world.
 */
export async function setPoolActive(
  user: AuthenticatedUser,
  unit: PoolUnit,
  next: boolean | null,
): Promise<{ unitType: UnitType; id: string; name: string; active: boolean }> {
  assertCanSetPoolVisibility(user, unit);

  const current =
    unit.type === "stake"
      ? await prisma.stake.findUnique({
          where: { id: unit.id },
          select: { id: true, name: true, ysaPoolActive: true },
        })
      : await prisma.district.findUnique({
          where: { id: unit.id },
          select: { id: true, name: true, ysaPoolActive: true },
        });

  if (!current) throw notFound(`${unit.type === "stake" ? "Stake" : "District"} not found`);

  const active = next ?? !current.ysaPoolActive;

  if (unit.type === "stake") {
    await prisma.stake.update({ where: { id: unit.id }, data: { ysaPoolActive: active } });
  } else {
    await prisma.district.update({ where: { id: unit.id }, data: { ysaPoolActive: active } });
  }

  logger.info("pool visibility changed", {
    unitType: unit.type,
    unitId: unit.id,
    active,
    changedBy: user.id,
  });

  return { unitType: unit.type, id: current.id, name: current.name, active };
}

export interface BulkPoolInput {
  active: boolean;
  target: "all" | "stakes" | "districts";
  continent?: string | undefined;
  query?: string | undefined;
}

export interface BulkPoolResult {
  target: BulkPoolInput["target"];
  active: boolean;
  updated: { stakes: number; districts: number; total: number };
}

/**
 * Bulk open or close pools matching a continent and text filter.
 *
 * Candidates are restricted to units the caller may actually administer, so a
 * scoped leader can only ever flip their own stake or district. Filtering stays
 * in TypeScript because a unit's continent may be inferred from its country
 * rather than stored.
 */
export async function bulkSetPoolActive(
  user: AuthenticatedUser,
  input: BulkPoolInput,
): Promise<BulkPoolResult> {
  const filters = ownUnitFilters(user);
  const wantStakes = input.target === "all" || input.target === "stakes";
  const wantDistricts = input.target === "all" || input.target === "districts";

  const [stakeRows, districtRows] = await Promise.all([
    wantStakes && filters.stakes
      ? readStakes(filters.stakes)
      : Promise.resolve<UnitRow[]>([]),
    wantDistricts && filters.districts
      ? readDistricts(filters.districts)
      : Promise.resolve<UnitRow[]>([]),
  ]);

  const wantedContinent = (input.continent ?? "").trim().toLowerCase();
  const search = (input.query ?? "").trim().toLowerCase();

  const matches = (row: UnitRow): boolean => {
    const continent = (resolveContinent(row) ?? "").toLowerCase();
    const continentOk =
      !wantedContinent || wantedContinent === "all" || continent === wantedContinent;
    const haystack = `${row.name} ${row.country ?? ""}`.toLowerCase();
    return continentOk && (!search || haystack.includes(search));
  };

  const selectIds = (unitType: UnitType, rows: UnitRow[]): string[] =>
    rows
      .filter((row) => matches(row) && canSetPoolVisibility(user, { type: unitType, id: row.id }))
      .map((row) => row.id);

  const stakeIds = selectIds("stake", stakeRows);
  const districtIds = selectIds("district", districtRows);

  const [stakes, districts] = await prisma.$transaction([
    prisma.stake.updateMany({
      where: { id: { in: stakeIds } },
      data: { ysaPoolActive: input.active },
    }),
    prisma.district.updateMany({
      where: { id: { in: districtIds } },
      data: { ysaPoolActive: input.active },
    }),
  ]);

  logger.info("pool visibility bulk change", {
    changedBy: user.id,
    active: input.active,
    target: input.target,
    stakes: stakes.count,
    districts: districts.count,
  });

  return {
    target: input.target,
    active: input.active,
    updated: {
      stakes: stakes.count,
      districts: districts.count,
      total: stakes.count + districts.count,
    },
  };
}

// ─── Unit administration ────────────────────────────────────────────────────

function assertGlobalControl(user: AuthenticatedUser): void {
  if (!hasGlobalPoolControl(user)) {
    throw forbidden("Only area leadership or IT support can administer units.");
  }
}

export async function updateUnitLocation(
  user: AuthenticatedUser,
  unitType: UnitType,
  id: string,
  location: { country: string; continent: Continent },
): Promise<{ unitType: UnitType; id: string; name: string; country: string | null; continent: string | null }> {
  assertGlobalControl(user);

  const data = { country: location.country, continent: location.continent };
  const select = { id: true, name: true, country: true, continent: true } as const;

  const existing =
    unitType === "stake"
      ? await prisma.stake.findUnique({ where: { id }, select: { id: true } })
      : await prisma.district.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw notFound(`${unitType === "stake" ? "Stake" : "District"} not found`);

  const updated =
    unitType === "stake"
      ? await prisma.stake.update({ where: { id }, data, select })
      : await prisma.district.update({ where: { id }, data, select });

  logger.info("unit location corrected", { unitType, unitId: id, updatedBy: user.id });

  return { unitType, ...updated };
}

/**
 * Deletes a stake or district.
 *
 * The old handler queried `information_schema` for every foreign key pointing at
 * the table, then nulled or deleted each referencing row with the table and
 * column names interpolated into the statement. The schema now declares those
 * referential actions (`SetNull` for users, wards and branches, `Cascade` for
 * pool memberships), so the database performs the cleanup and there is no
 * dynamic SQL to get wrong.
 *
 * Its other check, refusing deletion when `conversations.district_id` existed,
 * is obsolete: a conversation is scoped to a mission, never to a district.
 */
export async function deleteUnit(
  user: AuthenticatedUser,
  unitType: UnitType,
  id: string,
): Promise<{ unitType: UnitType; id: string; name: string }> {
  assertGlobalControl(user);

  const existing =
    unitType === "stake"
      ? await prisma.stake.findUnique({ where: { id }, select: { id: true, name: true } })
      : await prisma.district.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!existing) throw notFound(`${unitType === "stake" ? "Stake" : "District"} not found`);

  const [users, memberships] = await Promise.all([
    prisma.user.count({
      where: unitType === "stake" ? { stakeId: id } : { districtId: id },
    }),
    prisma.stakePoolMember.count({
      where: unitType === "stake" ? { stakeId: id } : { districtId: id },
    }),
  ]);

  if (unitType === "stake") {
    await prisma.stake.delete({ where: { id } });
  } else {
    await prisma.district.delete({ where: { id } });
  }

  logger.warn("unit deleted", {
    unitType,
    unitId: id,
    deletedBy: user.id,
    detachedUsers: users,
    deletedMemberships: memberships,
  });

  return { unitType, id: existing.id, name: existing.name };
}

// ─── Member self-service ────────────────────────────────────────────────────

export type PoolStatus = "no_unit" | "not_requested" | "pending" | "approved";

export interface MyPoolStatus {
  status: PoolStatus;
  unit: { unitType: UnitType; id: string; name: string; ysaPoolActive: boolean } | null;
  membershipId: string | null;
  requestedAt: Date | null;
  approvedAt: Date | null;
}

/** The caller's own stake or district, with its pool state. */
async function homeUnitWithState(user: AuthenticatedUser): Promise<{
  unit: PoolUnit;
  row: { id: string; name: string; country: string | null; ysaPoolActive: boolean };
} | null> {
  const unit = homeUnitOf(user);
  if (!unit) return null;

  const select = { id: true, name: true, country: true, ysaPoolActive: true } as const;
  const row =
    unit.type === "stake"
      ? await prisma.stake.findUnique({ where: { id: unit.id }, select })
      : await prisma.district.findUnique({ where: { id: unit.id }, select });

  return row ? { unit, row } : null;
}

export async function myPoolStatus(user: AuthenticatedUser): Promise<MyPoolStatus> {
  const home = await homeUnitWithState(user);
  if (!home) {
    return { status: "no_unit", unit: null, membershipId: null, requestedAt: null, approvedAt: null };
  }

  const membership = await prisma.stakePoolMember.findFirst({
    where: { userId: user.id, ...membershipUnitFilter(home.unit) },
    select: { id: true, approved: true, approvedAt: true, createdAt: true },
  });

  const unit = {
    unitType: home.unit.type,
    id: home.row.id,
    name: home.row.name,
    ysaPoolActive: home.row.ysaPoolActive,
  };

  if (!membership) {
    return { status: "not_requested", unit, membershipId: null, requestedAt: null, approvedAt: null };
  }

  return {
    status: membership.approved ? "approved" : "pending",
    unit,
    membershipId: membership.id,
    requestedAt: membership.createdAt,
    approvedAt: membership.approvedAt,
  };
}

/**
 * Self-nomination into the caller's own pool.
 *
 * Previously stake-only, and the row it wrote carried the stake id in the single
 * `stake_id` column. A member of a district now joins their district's pool
 * instead of being turned away.
 */
export async function requestPoolMembership(
  user: AuthenticatedUser,
): Promise<{ unitType: UnitType; unitId: string; membershipId: string }> {
  const unit = homeUnitOf(user);
  if (!unit) throw badRequest("You are not assigned to a stake or district.");

  const columns = membershipUnitFilter(unit);
  const existing = await prisma.stakePoolMember.findFirst({
    where: { userId: user.id, ...columns },
    select: { id: true },
  });
  if (existing) throw conflict("You have already requested to join the pool.");

  const membership = await prisma.stakePoolMember.create({
    data: { userId: user.id, ...columns, addedById: user.id, approved: false },
    select: { id: true },
  });

  logger.info("pool membership requested", {
    membershipId: membership.id,
    memberId: user.id,
    unitType: unit.type,
    unitId: unit.id,
  });
  // INTEGRATION: notify the unit's leaders that a pool request is waiting.

  return { unitType: unit.type, unitId: unit.id, membershipId: membership.id };
}

export interface MyUnitPool {
  unit: { unitType: UnitType; id: string; name: string; country: string | null; ysaPoolActive: boolean } | null;
  myStatus: PoolStatus;
  members: DirectoryMember[];
}

/** Approved members of the caller's own pool. */
export async function myUnitPool(user: AuthenticatedUser): Promise<MyUnitPool> {
  const home = await homeUnitWithState(user);
  if (!home) return { unit: null, myStatus: "no_unit", members: [] };

  const columns = membershipUnitFilter(home.unit);

  const [self, memberships, unitRow] = await Promise.all([
    prisma.stakePoolMember.findFirst({
      where: { userId: user.id, ...columns },
      select: { approved: true },
    }),
    prisma.stakePoolMember.findMany({
      where: { ...columns, approved: true, user: VISIBLE_IN_DIRECTORY },
      select: { user: { select: DIRECTORY_USER_SELECT } },
    }),
    home.unit.type === "stake"
      ? prisma.stake.findUnique({ where: { id: home.unit.id }, select: UNIT_SELECT })
      : prisma.district.findUnique({ where: { id: home.unit.id }, select: UNIT_SELECT }),
  ]);

  const place = unitRow
    ? placeOf(unitRow)
    : { name: home.row.name, country: home.row.country, continent: null, areaName: null };

  const members = memberships
    .filter((row) => canViewProfile(user, row.user))
    .map((row) => toDirectoryMember(row.user, { type: home.unit.type, id: home.unit.id, place }))
    .sort((left, right) => left.fullName.localeCompare(right.fullName));

  return {
    unit: {
      unitType: home.unit.type,
      id: home.row.id,
      name: home.row.name,
      country: home.row.country,
      ysaPoolActive: home.row.ysaPoolActive,
    },
    myStatus: self ? (self.approved ? "approved" : "pending") : "not_requested",
    members,
  };
}

// ─── Discovery ──────────────────────────────────────────────────────────────

/**
 * Approved members of every open pool worldwide.
 *
 * District pools appear here for the first time. The old query joined `stakes`
 * on the shared `stake_id` column, so a district's members were unreachable even
 * in the reads that pretended to support them.
 */
export async function discoverPool(
  user: AuthenticatedUser,
  filters: DirectoryFilters & { limit: number },
): Promise<DirectoryMember[]> {
  const memberships = await prisma.stakePoolMember.findMany({
    where: {
      approved: true,
      userId: { not: user.id },
      user: directoryMemberWhere(filters),
      OR: [{ stake: { ysaPoolActive: true } }, { district: { ysaPoolActive: true } }],
    },
    // Ordered so the bounded slice is deterministic rather than whatever the
    // planner returns first.
    orderBy: { createdAt: "desc" },
    take: filters.limit,
    select: {
      user: { select: DIRECTORY_USER_SELECT },
      stake: { select: UNIT_SELECT },
      district: { select: UNIT_SELECT },
    },
  });

  const members: DirectoryMember[] = [];
  for (const row of memberships) {
    if (!canViewProfile(user, row.user)) continue;
    const unitRow = row.stake ?? row.district;
    if (!unitRow) continue;
    members.push(
      toDirectoryMember(row.user, {
        type: row.stake ? "stake" : "district",
        id: unitRow.id,
        place: placeOf(unitRow),
      }),
    );
  }

  return members.sort(compareMembers);
}

/**
 * Every stake and district with a count of matching pool members.
 *
 * Units whose continent cannot be resolved are dropped, as before, so the client
 * can group by continent without a catch-all bucket.
 */
export async function directoryUnits(
  user: AuthenticatedUser,
  filters: DirectoryFilters,
): Promise<DirectoryUnit[]> {
  const hasFilter = Boolean(filters.gender) || (filters.ageRanges?.length ?? 0) > 0;

  const [stakes, districts, counts] = await Promise.all([
    readStakes({}),
    readDistricts({}),
    countApprovedMembers(directoryMemberWhere(filters), user.id),
  ]);

  const units = [
    ...stakes.map((row) => toDirectoryUnit("stake", row, counts.stakes.get(row.id) ?? 0)),
    ...districts.map((row) => toDirectoryUnit("district", row, counts.districts.get(row.id) ?? 0)),
  ];

  return units
    .filter((unit) => unit.continent !== null)
    .filter((unit) => !hasFilter || unit.memberCount > 0)
    .sort(compareByPlace);
}

/** Open pools only, with their approved-member counts. */
export async function openPoolUnits(user: AuthenticatedUser): Promise<DirectoryUnit[]> {
  const [stakes, districts, counts] = await Promise.all([
    readStakes({ ysaPoolActive: true }),
    readDistricts({ ysaPoolActive: true }),
    countApprovedMembers(
      { status: "active", directoryVisible: true, profileHidden: false },
      user.id,
    ),
  ]);

  return [
    ...stakes.map((row) => toDirectoryUnit("stake", row, counts.stakes.get(row.id) ?? 0)),
    ...districts.map((row) => toDirectoryUnit("district", row, counts.districts.get(row.id) ?? 0)),
  ].sort(compareByPlace);
}

/**
 * The roster of one unit's pool.
 *
 * `stake-members/:stakeId` returned a full member list for any id at all,
 * regardless of whether that pool was open or had anything to do with the
 * caller. A roster is now readable only when the pool is open, or the caller
 * belongs to that unit, or the caller leads it.
 */
export async function unitPoolMembers(
  user: AuthenticatedUser,
  unitId: string,
): Promise<{ unit: DirectoryUnit; members: DirectoryMember[] }> {
  const resolved = await resolveUnit(unitId);
  if (!resolved) throw notFound("Unit not found");

  const home = homeUnitOf(user);
  const isHome = home?.type === resolved.unit.type && home.id === resolved.unit.id;
  if (!resolved.row.ysaPoolActive && !isHome && !leadsUnit(user, resolved.unit)) {
    throw forbidden("That pool is not open.");
  }

  const memberships = await prisma.stakePoolMember.findMany({
    where: {
      ...membershipUnitFilter(resolved.unit),
      approved: true,
      userId: { not: user.id },
      user: VISIBLE_IN_DIRECTORY,
    },
    select: { user: { select: DIRECTORY_USER_SELECT } },
  });

  const place = placeOf(resolved.row);
  const members = memberships
    .filter((row) => canViewProfile(user, row.user))
    .map((row) =>
      toDirectoryMember(row.user, {
        type: resolved.unit.type,
        id: resolved.unit.id,
        place,
      }),
    )
    .sort((left, right) => left.fullName.localeCompare(right.fullName));

  return {
    unit: toDirectoryUnit(resolved.unit.type, resolved.row, members.length),
    members,
  };
}

// ─── Leader directory ───────────────────────────────────────────────────────

const PRESIDING_ROLES: LeadershipRole[] = ["stake_presidency", "district_presidency"];

/** Stakes and districts with a count of presiding leaders the caller may see. */
export async function leaderDirectory(user: AuthenticatedUser): Promise<DirectoryUnit[]> {
  const leaderWhere: Prisma.UserWhereInput = {
    ...VISIBLE_IN_DIRECTORY,
    role: { in: PRESIDING_ROLES },
    id: { not: user.id },
  };

  const [stakes, districts, stakeGroups, districtGroups] = await Promise.all([
    readStakes({}),
    readDistricts({}),
    prisma.user.groupBy({
      by: ["stakeId"],
      where: { ...leaderWhere, stakeId: { not: null } },
      _count: { _all: true },
    }),
    prisma.user.groupBy({
      by: ["districtId"],
      where: { ...leaderWhere, districtId: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const stakeCounts = new Map<string, number>();
  for (const group of stakeGroups) {
    if (group.stakeId) stakeCounts.set(group.stakeId, group._count._all);
  }
  const districtCounts = new Map<string, number>();
  for (const group of districtGroups) {
    if (group.districtId) districtCounts.set(group.districtId, group._count._all);
  }

  return [
    ...stakes.map((row) => toDirectoryUnit("stake", row, stakeCounts.get(row.id) ?? 0)),
    ...districts.map((row) => toDirectoryUnit("district", row, districtCounts.get(row.id) ?? 0)),
  ]
    .filter((unit) => unit.continent !== null)
    .sort(compareByPlace);
}

export async function leaderMembers(
  user: AuthenticatedUser,
  unitId: string,
): Promise<DirectoryMember[]> {
  const resolved = await resolveUnit(unitId);
  if (!resolved) throw notFound("Unit not found");

  const leaders = await prisma.user.findMany({
    where: {
      ...VISIBLE_IN_DIRECTORY,
      role: { in: PRESIDING_ROLES },
      id: { not: user.id },
      ...(resolved.unit.type === "stake"
        ? { stakeId: resolved.unit.id }
        : { districtId: resolved.unit.id }),
    },
    select: DIRECTORY_USER_SELECT,
  });

  const place = placeOf(resolved.row);
  return leaders
    .filter((person) => canViewProfile(user, person))
    .map((person) =>
      toDirectoryMember(person, { type: resolved.unit.type, id: resolved.unit.id, place }),
    )
    .sort((left, right) => left.fullName.localeCompare(right.fullName));
}

// ─── Mission directory ──────────────────────────────────────────────────────

/**
 * Missions with a count of missionaries the caller may see.
 *
 * The old endpoint listed every mission for every caller and let anyone read any
 * mission's roster by id, which contradicted the mission scoping applied
 * everywhere else: a serving missionary may only see their own mission.
 */
export async function missionDirectory(user: AuthenticatedUser): Promise<DirectoryUnit[]> {
  const allowed = visibleMissionIds(user);
  if (allowed !== null && allowed.length === 0) return [];

  const missionWhere: Prisma.MissionWhereInput = allowed === null ? {} : { id: { in: allowed } };

  const [missions, groups] = await Promise.all([
    prisma.mission.findMany({
      where: missionWhere,
      select: {
        id: true,
        name: true,
        country: true,
        area: { select: { name: true, continent: true } },
      },
    }),
    prisma.user.groupBy({
      by: ["missionId"],
      where: {
        ...VISIBLE_IN_DIRECTORY,
        role: "missionary",
        id: { not: user.id },
        missionId: allowed === null ? { not: null } : { in: allowed },
      },
      _count: { _all: true },
    }),
  ]);

  const counts = new Map<string, number>();
  for (const group of groups) {
    if (group.missionId) counts.set(group.missionId, group._count._all);
  }

  return missions
    .map((mission) => {
      // A mission carries no pool of its own, so it borrows the unit shape with
      // `unitType: "mission"` and a closed pool flag.
      const row: UnitRow = {
        id: mission.id,
        name: mission.name,
        country: mission.country,
        continent: mission.area?.continent ?? null,
        ysaPoolActive: false,
        coordinatingCouncil: mission.area ? { area: mission.area } : null,
      };
      return toDirectoryUnit("mission", row, counts.get(mission.id) ?? 0);
    })
    .sort(compareByPlace);
}

export async function missionMembers(
  user: AuthenticatedUser,
  missionId: string,
): Promise<DirectoryMember[]> {
  const allowed = visibleMissionIds(user);
  if (allowed !== null && !allowed.includes(missionId)) {
    throw forbidden("You cannot browse that mission.");
  }

  const mission = await prisma.mission.findUnique({
    where: { id: missionId },
    select: {
      id: true,
      name: true,
      country: true,
      area: { select: { name: true, continent: true } },
    },
  });
  if (!mission) throw notFound("Mission not found");

  const missionaries = await prisma.user.findMany({
    where: {
      ...VISIBLE_IN_DIRECTORY,
      role: "missionary",
      missionId: mission.id,
      id: { not: user.id },
    },
    select: DIRECTORY_USER_SELECT,
  });

  const place: UnitPlace = {
    name: mission.name,
    country: mission.country,
    continent: mission.area?.continent ?? null,
    areaName: mission.area?.name ?? null,
  };

  return missionaries
    .filter((person) => canViewProfile(user, person))
    .map((person) => toDirectoryMember(person, { type: "mission", id: mission.id, place }))
    .sort((left, right) => left.fullName.localeCompare(right.fullName));
}
