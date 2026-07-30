import { randomInt } from "node:crypto";

import { env } from "../../config/env";
import { getRedis, redisKeys } from "../../config/redis";
import { describeError, logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { notFound } from "../../middleware/errorHandler";
import { cachedScriptureSchema, type CachedScripture } from "./schemas";

const SCRIPTURE_SELECT = {
  id: true,
  book: true,
  chapter: true,
  verse: true,
  text: true,
  volume: true,
  reference: true,
} as const;

type ScriptureRow = {
  id: string;
  book: string;
  chapter: number;
  verse: number;
  text: string;
  volume: string | null;
  reference: string | null;
};

/**
 * `reference` is the display form, such as "1 Nephi 3:7". Both old seed scripts
 * wrote that column even though no migration ever created it, so existing rows
 * may have it null. Derive it rather than returning null to the client.
 */
function toPublic(row: ScriptureRow): CachedScripture {
  return {
    id: row.id,
    book: row.book,
    chapter: row.chapter,
    verse: row.verse,
    text: row.text,
    volume: row.volume,
    reference: row.reference ?? `${row.book} ${row.chapter}:${row.verse}`,
  };
}

/**
 * Picks a scripture uniformly at random.
 *
 * `ORDER BY RANDOM() LIMIT 1` sorts the entire table on every call, which is
 * fine at a few thousand verses and quadratically less fine at the ~41,000 in
 * the standard works. Counting and skipping touches one index and one row.
 *
 * `randomInt` rather than `Math.random()`: this is not security sensitive, but
 * there is no reason to keep a second-rate generator around for a caller to
 * copy later.
 */
async function pickRandom(volume?: string): Promise<CachedScripture | null> {
  const where = volume ? { volume: { equals: volume, mode: "insensitive" as const } } : {};

  const total = await prisma.scripture.count({ where });
  if (total === 0) return null;

  const rows = await prisma.scripture.findMany({
    where,
    select: SCRIPTURE_SELECT,
    orderBy: { id: "asc" },
    skip: randomInt(total),
    take: 1,
  });

  const row = rows[0];
  return row ? toPublic(row) : null;
}

/**
 * The rotating scripture shown on the home screen, cached for
 * SCRIPTURE_ROTATE_MINS so every client in the window sees the same verse.
 *
 * A Redis outage degrades to an uncached database read. The old handler let the
 * Redis error escape into a 500, so losing the cache took the home screen down
 * with it.
 */
export async function currentScripture(): Promise<CachedScripture> {
  const cached = await readCache();
  if (cached) return cached;

  const scripture = await pickRandom();
  if (!scripture) throw notFound("No scriptures have been loaded.");

  await writeCache(scripture);
  return scripture;
}

async function readCache(): Promise<CachedScripture | null> {
  try {
    const redis = await getRedis();
    const raw = await redis.get(redisKeys.scriptureCurrent());
    if (!raw) return null;

    const parsed = cachedScriptureSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;

    logger.warn("discarding malformed cached scripture");
    return null;
  } catch (error) {
    logger.warn("scripture cache read failed", describeError(error));
    return null;
  }
}

async function writeCache(scripture: CachedScripture): Promise<void> {
  try {
    const redis = await getRedis();
    await redis.setEx(
      redisKeys.scriptureCurrent(),
      env.SCRIPTURE_ROTATE_MINS * 60,
      JSON.stringify(scripture),
    );
  } catch (error) {
    logger.warn("scripture cache write failed", describeError(error));
  }
}

/** A fresh random verse on every call, optionally restricted to one volume. */
export async function randomScripture(volume?: string): Promise<CachedScripture> {
  const scripture = await pickRandom(volume);
  if (!scripture) {
    throw notFound(volume ? `No scriptures found in ${volume}.` : "No scriptures have been loaded.");
  }
  return scripture;
}
