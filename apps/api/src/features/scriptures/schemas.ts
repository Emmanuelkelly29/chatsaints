import { z } from "zod";

/**
 * Scripture request validation.
 *
 * The old `/random` handler interpolated the `volume` query parameter straight
 * into the SQL string as a parameter placeholder decision:
 *
 *     `SELECT * FROM scriptures ${volume ? 'WHERE volume=$1' : ''} ...`
 *
 * The value itself was bound, so it was not injectable, but nothing constrained
 * its type or length, so `?volume[]=x` handed an array to the driver.
 */

export const randomScriptureQuerySchema = z.object({
  volume: z.string().trim().min(1).max(60).optional(),
});

/**
 * Shape of a cached scripture.
 *
 * The rotating scripture is stored in Redis as JSON, and `JSON.parse` returns
 * `unknown`. Validating on the way out means a stale or malformed cache entry
 * degrades to a fresh database read instead of being served as though it were a
 * scripture.
 */
export const cachedScriptureSchema = z.object({
  id: z.string(),
  book: z.string(),
  chapter: z.number().int(),
  verse: z.number().int(),
  text: z.string(),
  volume: z.string().nullable(),
  reference: z.string(),
});

export type CachedScripture = z.infer<typeof cachedScriptureSchema>;
export type RandomScriptureQuery = z.infer<typeof randomScriptureQuerySchema>;
