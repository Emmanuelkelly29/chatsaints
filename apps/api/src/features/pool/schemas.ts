import { z } from "zod";

import { badRequest } from "../../middleware/errorHandler";
import { AGE_RANGES } from "./ages";
import { CONTINENTS } from "./geography";
import type { UnitType } from "./scope";

/**
 * Request validation for the YSA pool surface.
 *
 * The old routes read ids, filters and booleans straight off `req.params`,
 * `req.query` and `req.body`. One of those filters, gender, was concatenated
 * into a SQL string: it was whitelisted first, but the statement was still built
 * by interpolation. Everything below is parsed before a handler sees it, and
 * every filter reaches the database as a Prisma argument.
 */

const uuid = z.string().uuid("A valid id is required");

/** Path parameter shapes. Names are kept as the old routes had them. */
export const idParams = z.object({ id: uuid });
export const stakeIdParams = z.object({ stakeId: uuid });
export const districtIdParams = z.object({ districtId: uuid });
export const unitIdParams = z.object({ unitId: uuid });
export const missionIdParams = z.object({ missionId: uuid });

export const unitPathParams = z.object({
  unitType: z
    .string()
    .transform((value) => value.trim().toLowerCase())
    .pipe(z.enum(["stake", "district"])),
  id: uuid,
});

/**
 * Path validation for the two routes that also carry a body, where `withBody`
 * has already claimed the handler. The same schema is used either way.
 */
export function parseUnitPath(params: unknown): { unitType: UnitType; id: string } {
  const parsed = unitPathParams.safeParse(params);
  if (!parsed.success) throw badRequest("unitType must be stake or district, with a valid id");
  return parsed.data;
}

export const membersQuery = z.object({
  // Preserves the old `includeMembers !== 'false'` default.
  includeMembers: z.enum(["true", "false"]).default("true"),
});

const optionalGender = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .pipe(z.enum(["male", "female"]))
  .optional();

const optionalAgeRanges = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0),
  )
  .pipe(z.array(z.enum(AGE_RANGES)).max(AGE_RANGES.length))
  .optional();

/**
 * Worldwide reads are bounded. The old `/discover` and `/global` queries had no
 * limit at all and would happily stream every pool member on earth.
 */
const worldwideLimit = z.coerce.number().int().min(1).max(1000).default(500);

export const directoryQuery = z.object({
  age_ranges: optionalAgeRanges,
  gender: optionalGender,
});

export const discoverQuery = z.object({
  age_ranges: optionalAgeRanges,
  gender: optionalGender,
  limit: worldwideLimit,
});

export const toggleAllBody = z.object({
  active: z.boolean(),
  target: z.enum(["all", "stakes", "districts"]).default("all"),
  continent: z.string().trim().max(40).optional(),
  query: z.string().trim().max(120).optional(),
});

export const unitLocationBody = z.object({
  country: z.string().trim().min(1, "country is required").max(80),
  continent: z.enum(CONTINENTS),
});

/**
 * Adding someone to a pool.
 *
 * `userId` is the only id taken from the caller. A unit may be named, but it is
 * checked against the units the caller actually leads, and the target has to
 * belong to it. The old handler inserted whatever `userId` and `stakeId` pair
 * the body contained.
 */
export const addMemberBody = z
  .object({
    userId: uuid,
    stakeId: uuid.optional(),
    districtId: uuid.optional(),
  })
  .refine((value) => !(value.stakeId && value.districtId), {
    message: "A membership belongs to a stake or a district, not both",
    path: ["districtId"],
  });
