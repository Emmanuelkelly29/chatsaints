/**
 * Continent resolution for directory grouping.
 *
 * A unit's continent comes from its own column, then from the area above it,
 * then from a lookup on its country. Units that resolve to nothing are reported
 * back to the caller as `skippedUnits` so the data can be corrected rather than
 * silently vanishing from the directory.
 */

export const CONTINENTS = [
  "Africa",
  "North America",
  "South America",
  "Europe",
  "Asia",
  "Oceania",
] as const;

export type Continent = (typeof CONTINENTS)[number];

const CONTINENT_SET: ReadonlySet<string> = new Set<string>(CONTINENTS);

export function isContinent(value: string): value is Continent {
  return CONTINENT_SET.has(value);
}

const COUNTRY_CONTINENT: Readonly<Record<string, Continent>> = {
  nigeria: "Africa",
  ghana: "Africa",
  kenya: "Africa",
  uganda: "Africa",
  southafrica: "Africa",
  southafricarepublic: "Africa",
  ethiopia: "Africa",
  morocco: "Africa",
  egypt: "Africa",
  unitedstates: "North America",
  usa: "North America",
  canada: "North America",
  mexico: "North America",
  brazil: "South America",
  argentina: "South America",
  colombia: "South America",
  peru: "South America",
  chile: "South America",
  unitedkingdom: "Europe",
  uk: "Europe",
  ireland: "Europe",
  france: "Europe",
  germany: "Europe",
  italy: "Europe",
  spain: "Europe",
  portugal: "Europe",
  netherlands: "Europe",
  belgium: "Europe",
  sweden: "Europe",
  norway: "Europe",
  finland: "Europe",
  denmark: "Europe",
  poland: "Europe",
  romania: "Europe",
  ukraine: "Europe",
  russia: "Europe",
  austria: "Europe",
  switzerland: "Europe",
  india: "Asia",
  pakistan: "Asia",
  bangladesh: "Asia",
  china: "Asia",
  japan: "Asia",
  southkorea: "Asia",
  philippines: "Asia",
  singapore: "Asia",
  indonesia: "Asia",
  thailand: "Asia",
  vietnam: "Asia",
  malaysia: "Asia",
  srilanka: "Asia",
  australia: "Oceania",
  newzealand: "Oceania",
  fiji: "Oceania",
  papuanewguinea: "Oceania",
};

function countryKey(country: string | null): string {
  return (country ?? "").toLowerCase().replace(/[^a-z]/g, "");
}

export function inferContinent(country: string | null): Continent | null {
  const key = countryKey(country);
  if (!key) return null;
  return COUNTRY_CONTINENT[key] ?? null;
}

/** A stake or district as loaded for the directory. */
export interface UnitRow {
  id: string;
  name: string;
  country: string | null;
  continent: string | null;
  ysaPoolActive: boolean;
  coordinatingCouncil: { area: { name: string; continent: string | null } | null } | null;
}

/** Select clause shared by Stake and District directory reads. */
export const UNIT_SELECT = {
  id: true,
  name: true,
  country: true,
  continent: true,
  ysaPoolActive: true,
  coordinatingCouncil: { select: { area: { select: { name: true, continent: true } } } },
} as const;

export function areaOf(unit: UnitRow): { name: string; continent: string | null } | null {
  return unit.coordinatingCouncil?.area ?? null;
}

export function resolveContinent(unit: UnitRow): string | null {
  return unit.continent ?? areaOf(unit)?.continent ?? inferContinent(unit.country);
}

/** Directory ordering: continent, then country, then unit name. */
export function compareByPlace(
  left: { continent: string | null; country: string | null; name: string },
  right: { continent: string | null; country: string | null; name: string },
): number {
  // Unplaced rows sort last rather than first, matching `NULLS LAST` in the SQL.
  const continentCmp = (left.continent ?? "￿").localeCompare(right.continent ?? "￿");
  if (continentCmp !== 0) return continentCmp;
  const countryCmp = (left.country ?? "￿").localeCompare(right.country ?? "￿");
  if (countryCmp !== 0) return countryCmp;
  return left.name.localeCompare(right.name);
}
