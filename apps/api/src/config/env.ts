import { z } from "zod";

/**
 * Validated environment. Importing this module is what enforces configuration:
 * if anything required is missing or malformed the process exits here, at boot,
 * instead of throwing on the first request that happens to need it.
 *
 * The previous build had no validation at all. It would start happily with no
 * JWT_SECRET and then return 500 on every login attempt.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  SHADOW_DATABASE_URL: z.string().optional(),

  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),

  // 32 chars is the floor, not a recommendation. Generate with:
  //   openssl rand -hex 64
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_EXPIRES_IN: z.string().default("7d"),

  // Comma-separated allowlist. Empty means no cross-origin browser requests.
  // Never "*": requests carry credentials.
  CORS_ORIGINS: z.string().default(""),

  SMTP_URL: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().optional(),

  STORAGE_TYPE: z.enum(["local", "s3"]).default("local"),
  LOCAL_UPLOAD_PATH: z.string().default("./uploads"),
  AWS_REGION: z.string().optional(),
  AWS_BUCKET: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),

  // ── Media processing ──────────────────────────────────────────
  // Images are resized and re-encoded once at upload. Every uploaded photo is
  // then smaller on disk and cheaper to fetch on every later view, which is the
  // difference between free local development and a storage bill later.
  MEDIA_MAX_UPLOAD_MB: z.coerce.number().int().positive().default(50),
  MEDIA_IMAGE_MAX_DIMENSION: z.coerce.number().int().positive().default(1920),
  MEDIA_IMAGE_QUALITY: z.coerce.number().int().min(1).max(100).default(80),
  // Avatars are displayed small, so they are capped much harder.
  MEDIA_AVATAR_MAX_DIMENSION: z.coerce.number().int().positive().default(512),
  MEDIA_AVATAR_QUALITY: z.coerce.number().int().min(1).max(100).default(80),

  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().optional(),
  APNS_KEY_ID: z.string().optional(),
  APNS_TEAM_ID: z.string().optional(),
  APNS_BUNDLE_ID: z.string().optional(),

  LIVEKIT_URL: z.string().optional(),
  LIVEKIT_API_KEY: z.string().optional(),
  LIVEKIT_API_SECRET: z.string().optional(),

  MAAS360_TENANT_ID: z.string().optional(),
  MAAS360_USERNAME: z.string().optional(),
  MAAS360_PASSWORD: z.string().optional(),
  MAAS360_APP_ID: z.string().optional(),
  MAAS360_APP_ACCESS_KEY: z.string().optional(),

  MAX_GROUP_SIZE: z.coerce.number().int().positive().default(1000),
  MAX_PINNED_CHATS: z.coerce.number().int().positive().default(3),
  SCRIPTURE_ROTATE_MINS: z.coerce.number().int().positive().default(5),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const lines = parsed.error.issues.map(
    (issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`,
  );
  console.error(
    `Invalid environment configuration:\n${lines.join("\n")}\n\n` +
      `Copy apps/api/.env.example to apps/api/.env and fill in real values.`,
  );
  process.exit(1);
}

export const env = parsed.data;

export const isProduction = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";

/** Parsed CORS allowlist. Empty array means deny all cross-origin browsers. */
export const corsOrigins: string[] = env.CORS_ORIGINS.split(",")
  .map((o) => o.trim())
  .filter((o) => o.length > 0);

/** Whether video calling is configured. When false, callers must say so. */
export const isLiveKitConfigured =
  Boolean(env.LIVEKIT_URL) && Boolean(env.LIVEKIT_API_KEY) && Boolean(env.LIVEKIT_API_SECRET);

/** Whether MDM enrollment is configured. When false, callers must say so. */
export const isMaas360Configured =
  Boolean(env.MAAS360_TENANT_ID) &&
  Boolean(env.MAAS360_USERNAME) &&
  Boolean(env.MAAS360_PASSWORD) &&
  Boolean(env.MAAS360_APP_ID) &&
  Boolean(env.MAAS360_APP_ACCESS_KEY);

/** Whether outbound email is configured. OTP delivery requires it. */
export const isSmtpConfigured =
  Boolean(env.SMTP_URL) || (Boolean(env.SMTP_HOST) && Boolean(env.SMTP_USER) && Boolean(env.SMTP_PASS));
