/**
 * Normalization applied at the write boundary, on every path that stores
 * user-entered data. Registration, profile updates, admin edits and imports all
 * go through here rather than trusting the form layer.
 */

/**
 * Emails are trimmed and lowercased before storing, and before any comparison
 * or lookup. Always use this on both sides of a match.
 */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** Capitalizes one whitespace-free token, respecting hyphens and apostrophes. */
function capitalizeToken(token: string): string {
  // Split on the separators that appear inside a single name token, keeping
  // them, so "mary-jane" and "o'brien" both capitalize each part.
  return token
    .split(/([-'’])/)
    .map((part) => {
      if (part.length === 0) return part;
      if (/^[-'’]$/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join("");
}

/**
 * Person names: trim, collapse repeated internal whitespace, and title-case
 * input that was typed in all caps or all lowercase, so "JOHN" and "john" both
 * become "John" and "mary-jane" becomes "Mary-Jane".
 *
 * Deliberate mixed case is preserved exactly as typed, because the user knows
 * better than we do: "McDonald", "van der Berg", "DeSoto" and "O'Brien" all
 * survive untouched.
 */
export function normalizePersonName(value: string): string {
  const collapsed = value.trim().replace(/\s+/g, " ");
  if (collapsed.length === 0) return collapsed;

  const hasLower = /[a-z]/.test(collapsed);
  const hasUpper = /[A-Z]/.test(collapsed);

  // Mixed case means the user made deliberate choices. Leave it alone.
  if (hasLower && hasUpper) return collapsed;

  return collapsed.split(" ").map(capitalizeToken).join(" ");
}

/** Collapses whitespace and trims. For free text that is not a person name. */
export function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * Phone numbers are stored exactly as they are matched against.
 *
 * The old registration path checked for duplicates using `phone_number.trim()`
 * but inserted the raw untrimmed value, so " +2348012345678" passed the
 * duplicate check and then stored a value that later lookups could not find.
 */
export function normalizePhone(value: string): string {
  return value.trim().replace(/[\s()-]/g, "");
}

/**
 * Candidate spellings of a phone number, used to find existing accounts that
 * were stored in local rather than international form.
 *
 * This exists only to match legacy rows. New rows always store the
 * international form.
 */
export function phoneVariants(phone: string): string[] {
  const normalized = normalizePhone(phone);
  const variants = new Set<string>([normalized]);

  if (normalized.startsWith("+")) {
    const digits = normalized.slice(1);
    for (const codeLength of [3, 2, 1]) {
      const local = digits.slice(codeLength);
      if (local.length >= 7) variants.add(`0${local}`);
    }
  } else if (normalized.startsWith("0") && normalized.length >= 10) {
    variants.add(`+234${normalized.slice(1)}`);
  }

  return [...variants];
}
