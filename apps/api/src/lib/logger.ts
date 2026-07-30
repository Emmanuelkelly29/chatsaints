import { env, isTest } from "../config/env";

/**
 * Minimal structured logger. Writes one JSON object per line so output is
 * greppable locally and parseable by a log drain in production.
 *
 * Replaces a winston setup that had zero import sites, and replaces the bare
 * console.log calls scattered through the old controllers. Those included lines
 * that printed live OTP codes to stdout unconditionally, so anyone with log
 * access could complete authentication as any user.
 *
 * Never log a credential, a token, an OTP, or a message body.
 */

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const minimum: Level = env.NODE_ENV === "production" ? "info" : "debug";

function write(level: Level, message: string, context?: Record<string, unknown>): void {
  if (isTest) return;
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minimum]) return;

  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    message,
    ...(context ?? {}),
  });

  if (level === "error" || level === "warn") {
    process.stderr.write(`${line}\n`);
  } else {
    process.stdout.write(`${line}\n`);
  }
}

/** Reduces an unknown thrown value to something safe to log. */
export function describeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
      ...(env.NODE_ENV === "production" ? {} : { stack: error.stack }),
    };
  }
  return { errorMessage: String(error) };
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => write("debug", message, context),
  info: (message: string, context?: Record<string, unknown>) => write("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) => write("warn", message, context),
  error: (message: string, context?: Record<string, unknown>) => write("error", message, context),
};
