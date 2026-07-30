import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { notFound } from "../../middleware/errorHandler";
import type { AreaFilterInput, CreateUnitInput, StakeFilterInput } from "./schemas";

/**
 * Church geography reads and unit maintenance.
 *
 * Everything here goes through Prisma. The old controller built DELETE
 * statements by reading `information_schema` at request time and interpolating
 * the discovered table and column names into SQL strings. Referential behaviour
 * is declared in schema.prisma instead: users, wards and branches have their
 * unit set to NULL, and pool memberships cascade.
 */

const UNIT_SELECT = {
  id: true,
  name: true,
  country: true,
  continent: true,
} as const;

const STAKE_LIST_SELECT = {
  id: true,
  name: true,
  country: true,
  continent: true,
  ysaPoolActive: true,
  coordinatingCouncil: {
    select: { id: true, name: true, area: { select: { id: true, name: true } } },
  },
} as const;

const DISTRICT_LIST_SELECT = {
  id: true,
  name: true,
  country: true,
  continent: true,
  ysaPoolActive: true,
  coordinatingCouncil: { select: { id: true, name: true } },
} as const;

// ─── Reads ──────────────────────────────────────────────────────────────────

export async function listAreas() {
  return prisma.area.findMany({
    select: { id: true, name: true, continent: true },
    orderBy: [{ continent: "asc" }, { name: "asc" }],
  });
}

export async function listStakes(filter: StakeFilterInput) {
  return prisma.stake.findMany({
    where: {
      // An area filter necessarily restricts to stakes that have a council,
      // which is what the old LEFT JOIN plus `a.id = $1` predicate did too.
      ...(filter.area_id ? { coordinatingCouncil: { areaId: filter.area_id } } : {}),
      ...(filter.country ? { country: { contains: filter.country, mode: "insensitive" } } : {}),
    },
    select: STAKE_LIST_SELECT,
    orderBy: [{ continent: "asc" }, { country: "asc" }, { name: "asc" }],
  });
}

export async function listDistricts(filter: AreaFilterInput) {
  return prisma.district.findMany({
    where: {
      ...(filter.area_id ? { coordinatingCouncil: { areaId: filter.area_id } } : {}),
    },
    select: DISTRICT_LIST_SELECT,
    orderBy: [{ continent: "asc" }, { country: "asc" }, { name: "asc" }],
  });
}

export async function listMissions(filter: AreaFilterInput) {
  return prisma.mission.findMany({
    where: { ...(filter.area_id ? { areaId: filter.area_id } : {}) },
    select: {
      id: true,
      name: true,
      country: true,
      area: { select: { id: true, name: true } },
    },
    orderBy: [{ country: "asc" }, { name: "asc" }],
  });
}

// ─── Find-or-create ─────────────────────────────────────────────────────────

export interface UnitUpsertResult {
  unit: { id: string; name: string; country: string | null; continent: string | null };
  created: boolean;
}

/**
 * Find-or-create a stake, matching case-insensitively on name plus country.
 *
 * A second pass merges a legacy row that carries the same name but no country,
 * which is how units created by the earlier registration flow were stored.
 */
export async function findOrCreateStake(input: CreateUnitInput): Promise<UnitUpsertResult> {
  const exact = await prisma.stake.findFirst({
    where: {
      name: { equals: input.name, mode: "insensitive" },
      country: { equals: input.country, mode: "insensitive" },
    },
    select: UNIT_SELECT,
  });

  if (exact) {
    if (input.continent && !exact.continent) {
      return {
        unit: await prisma.stake.update({
          where: { id: exact.id },
          data: { continent: input.continent },
          select: UNIT_SELECT,
        }),
        created: false,
      };
    }
    return { unit: exact, created: false };
  }

  const sameName = await prisma.stake.findMany({
    where: { name: { equals: input.name, mode: "insensitive" } },
    select: UNIT_SELECT,
    take: 2,
  });
  const [onlyMatch] = sameName;
  if (sameName.length === 1 && onlyMatch && !onlyMatch.country) {
    return {
      unit: await prisma.stake.update({
        where: { id: onlyMatch.id },
        data: {
          country: input.country,
          ...(input.continent ? { continent: input.continent } : {}),
        },
        select: UNIT_SELECT,
      }),
      created: false,
    };
  }

  return {
    unit: await prisma.stake.create({
      data: {
        name: input.name,
        country: input.country,
        continent: input.continent ?? null,
      },
      select: UNIT_SELECT,
    }),
    created: true,
  };
}

export async function findOrCreateDistrict(input: CreateUnitInput): Promise<UnitUpsertResult> {
  const exact = await prisma.district.findFirst({
    where: {
      name: { equals: input.name, mode: "insensitive" },
      country: { equals: input.country, mode: "insensitive" },
    },
    select: UNIT_SELECT,
  });

  if (exact) {
    if (input.continent && !exact.continent) {
      return {
        unit: await prisma.district.update({
          where: { id: exact.id },
          data: { continent: input.continent },
          select: UNIT_SELECT,
        }),
        created: false,
      };
    }
    return { unit: exact, created: false };
  }

  const sameName = await prisma.district.findMany({
    where: { name: { equals: input.name, mode: "insensitive" } },
    select: UNIT_SELECT,
    take: 2,
  });
  const [onlyMatch] = sameName;
  if (sameName.length === 1 && onlyMatch && !onlyMatch.country) {
    return {
      unit: await prisma.district.update({
        where: { id: onlyMatch.id },
        data: {
          country: input.country,
          ...(input.continent ? { continent: input.continent } : {}),
        },
        select: UNIT_SELECT,
      }),
      created: false,
    };
  }

  return {
    unit: await prisma.district.create({
      data: {
        name: input.name,
        country: input.country,
        continent: input.continent ?? null,
      },
      select: UNIT_SELECT,
    }),
    created: true,
  };
}

// ─── Rename and delete ──────────────────────────────────────────────────────

export async function renameStake(id: string, name: string, actorId: string) {
  const existing = await prisma.stake.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw notFound("Stake not found");

  const updated = await prisma.stake.update({ where: { id }, data: { name }, select: UNIT_SELECT });
  logger.info("stake renamed", { stakeId: id, actorId });
  return updated;
}

export async function renameDistrict(id: string, name: string, actorId: string) {
  const existing = await prisma.district.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw notFound("District not found");

  const updated = await prisma.district.update({
    where: { id },
    data: { name },
    select: UNIT_SELECT,
  });
  logger.info("district renamed", { districtId: id, actorId });
  return updated;
}

/**
 * Deleting a unit detaches every member of it, so the count is reported back and
 * logged. Referential behaviour comes from the schema: users, wards and branches
 * are detached, pool memberships are removed.
 */
export async function deleteStake(id: string, actorId: string) {
  const existing = await prisma.stake.findUnique({
    where: { id },
    select: { ...UNIT_SELECT, _count: { select: { users: true, wards: true, branches: true } } },
  });
  if (!existing) throw notFound("Stake not found");

  await prisma.stake.delete({ where: { id } });
  logger.warn("stake deleted", {
    stakeId: id,
    actorId,
    detachedUsers: existing._count.users,
    detachedWards: existing._count.wards,
    detachedBranches: existing._count.branches,
  });

  return {
    id: existing.id,
    name: existing.name,
    country: existing.country,
    continent: existing.continent,
    detached: {
      users: existing._count.users,
      wards: existing._count.wards,
      branches: existing._count.branches,
    },
  };
}

export async function deleteDistrict(id: string, actorId: string) {
  const existing = await prisma.district.findUnique({
    where: { id },
    select: { ...UNIT_SELECT, _count: { select: { users: true, branches: true } } },
  });
  if (!existing) throw notFound("District not found");

  await prisma.district.delete({ where: { id } });
  logger.warn("district deleted", {
    districtId: id,
    actorId,
    detachedUsers: existing._count.users,
    detachedBranches: existing._count.branches,
  });

  return {
    id: existing.id,
    name: existing.name,
    country: existing.country,
    continent: existing.continent,
    detached: {
      users: existing._count.users,
      branches: existing._count.branches,
    },
  };
}
