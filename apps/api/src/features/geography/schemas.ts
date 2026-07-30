import { z } from "zod";

import { normalizeText } from "../../lib/normalize";

/**
 * Request validation for the geography surface.
 *
 * The old controller read `req.body.name` / `req.query.area_id` straight off the
 * request and hand-checked truthiness, then interpolated the results into SQL
 * built from `information_schema` lookups. Everything here is parsed and
 * narrowed before a handler sees it.
 */

/** Query parameters arrive as strings. An empty one means "not supplied". */
const optionalUuidParam = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().uuid("A valid id is required").optional(),
);

const optionalSearchTerm = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().trim().min(1).max(80).transform(normalizeText).optional(),
);

const unitName = z
  .string()
  .trim()
  .min(2, "name is required")
  .max(120, "name is too long")
  .transform(normalizeText);

const unitCountry = z
  .string()
  .trim()
  .min(2, "country is required")
  .max(80, "country is too long")
  .transform(normalizeText);

const unitContinent = z
  .string()
  .trim()
  .min(2)
  .max(100)
  .transform(normalizeText)
  .optional();

export const areaFilterSchema = z.object({
  area_id: optionalUuidParam,
});

export const stakeFilterSchema = z.object({
  area_id: optionalUuidParam,
  country: optionalSearchTerm,
});

export const unitParamsSchema = z.object({
  id: z.string().uuid("A valid unit id is required"),
});

/**
 * Country is required on create. Without it the old find-or-create matched on
 * name alone and happily merged two unrelated stakes that share a name, of
 * which there are many.
 */
export const createUnitSchema = z.object({
  name: unitName,
  country: unitCountry,
  continent: unitContinent,
});

export const renameUnitSchema = z.object({
  name: unitName,
});

export type CreateUnitInput = z.infer<typeof createUnitSchema>;
export type StakeFilterInput = z.infer<typeof stakeFilterSchema>;
export type AreaFilterInput = z.infer<typeof areaFilterSchema>;
