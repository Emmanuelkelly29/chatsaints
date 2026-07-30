/**
 * Response key serialization.
 *
 * Internally everything is camelCase, because that is what the Prisma client
 * generates and what reads naturally in TypeScript. On the wire the API has
 * always spoken snake_case, and the Flutter client's models read snake_case
 * keys. Rather than rename fields across 133 handlers, or rewrite every Dart
 * model against an app that cannot currently be built, the conversion happens
 * once at the response boundary.
 *
 * Request bodies are NOT touched. Their zod schemas already expect snake_case,
 * which keeps the inbound contract exactly as it was.
 */

/**
 * Only convert keys that are unambiguously camelCase identifiers written by us.
 *
 * The uppercase requirement means `id` and `email` are left alone, and the
 * pattern excludes anything containing an underscore, dash or dot. That matters
 * because some response objects are keyed by data rather than by field name: a
 * uuid, an emoji, or an already-snake_case key must survive untouched.
 */
const CAMEL_IDENTIFIER = /^[a-z][a-zA-Z0-9]*$/;

function shouldConvertKey(key: string): boolean {
  return CAMEL_IDENTIFIER.test(key) && /[A-Z]/.test(key);
}

/**
 * Acronym-aware, so `canViewYSADirectory` becomes `can_view_ysa_directory`
 * rather than `can_view_y_s_a_directory`. Splitting on every capital mangles
 * any run of them.
 */
export function camelToSnake(key: string): string {
  return (
    key
      // A lowercase or digit followed by a capital: fullName -> full_Name
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      // The tail of an acronym before a new word: YSADirectory -> YSA_Directory
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
      .toLowerCase()
  );
}

/** Guards against a pathological or unexpectedly deep structure. */
const MAX_DEPTH = 24;

/**
 * Deeply rewrites object keys to snake_case, leaving values alone.
 *
 * BigInt is converted to a string on the way through. `JSON.stringify` throws
 * on BigInt, and `Message.mediaSizeBytes` is one, so without this a message
 * carrying a media size would have produced a 500. node-postgres rendered that
 * column as a string previously, so this also matches the old wire format.
 */
export function toSnakeCaseDeep(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return value;

  if (typeof value === "bigint") return value.toString();

  if (value === null || typeof value !== "object") return value;

  // Dates serialize themselves, and binary payloads must not be walked.
  if (value instanceof Date) return value;
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) return value;

  if (Array.isArray(value)) {
    return value.map((item) => toSnakeCaseDeep(item, depth + 1));
  }

  // Anything with a custom prototype is left intact rather than rebuilt as a
  // plain object, which would drop its behaviour.
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "__proto__" || key === "constructor") continue;
    const outputKey = shouldConvertKey(key) ? camelToSnake(key) : key;
    result[outputKey] = toSnakeCaseDeep(item, depth + 1);
  }
  return result;
}
