/**
 * Age ranges for the YSA directory.
 *
 * The old queries computed these with `EXTRACT(YEAR FROM AGE(date_of_birth))`
 * inside four hand-written SQL fragments, and the filter variant concatenated a
 * gender value straight into the statement. Both the label and the filter are
 * derived here instead: the label in TypeScript, the filter as a date window
 * that Prisma can parameterise.
 */

export const AGE_RANGES = ["18-22", "23-26", "27-30", "31-35"] as const;

export type AgeRange = (typeof AGE_RANGES)[number];

/** Anyone outside the listed bands is labelled generically, as before. */
export type AgeLabel = AgeRange | "YSA";

const BOUNDS: Record<AgeRange, readonly [number, number]> = {
  "18-22": [18, 22],
  "23-26": [23, 26],
  "27-30": [27, 30],
  "31-35": [31, 35],
};

/**
 * Completed years between two dates.
 *
 * Prisma reads a `date` column as midnight UTC, so the UTC accessors are the
 * correct ones: using local ones would shift the birthday by a day for anyone
 * west of Greenwich.
 */
function completedYears(from: Date, to: Date): number {
  let years = to.getUTCFullYear() - from.getUTCFullYear();
  const monthDelta = to.getUTCMonth() - from.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && to.getUTCDate() < from.getUTCDate())) {
    years -= 1;
  }
  return years;
}

export function ageLabelOf(dateOfBirth: Date | null, now = new Date()): AgeLabel | null {
  if (!dateOfBirth) return null;
  const age = completedYears(dateOfBirth, now);
  for (const range of AGE_RANGES) {
    const [low, high] = BOUNDS[range];
    if (age >= low && age <= high) return range;
  }
  return "YSA";
}

function shiftYears(from: Date, years: number): Date {
  return new Date(Date.UTC(from.getUTCFullYear() + years, from.getUTCMonth(), from.getUTCDate()));
}

/**
 * The birth-date window matching an age band.
 *
 * Age >= low means born on or before today minus `low` years. Age <= high means
 * born strictly after today minus `high + 1` years.
 */
export function dateOfBirthWindow(range: AgeRange, now = new Date()): { gt: Date; lte: Date } {
  const [low, high] = BOUNDS[range];
  return { gt: shiftYears(now, -(high + 1)), lte: shiftYears(now, -low) };
}
