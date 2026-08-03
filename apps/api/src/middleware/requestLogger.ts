import type { RequestHandler } from "express";

import { logger } from "../lib/logger";

/**
 * One log line per request.
 *
 * The rewrite dropped `morgan` and never replaced it, which left the server
 * almost silent: only startup, unhandled errors, and a few explicit info lines.
 * A rate-limited request logged nothing at all, because express-rate-limit
 * writes its own 429 and never reaches the error handler, so the API looked
 * like it was not being hit when it very much was.
 *
 * Registered before the rate limiters so their rejections are visible too.
 */
export const requestLogger: RequestHandler = (req, res, next) => {
  const startedAt = performance.now();

  res.on("finish", () => {
    const durationMs = Math.round(performance.now() - startedAt);
    const context = {
      method: req.method,
      path: req.originalUrl.split("?")[0],
      status: res.statusCode,
      durationMs,
    };

    // Health checks are polled constantly and would drown everything else.
    if (req.path === "/health" && res.statusCode < 400) {
      logger.debug("request", context);
      return;
    }

    if (res.statusCode >= 500) {
      logger.error("request", context);
    } else if (res.statusCode >= 400) {
      logger.warn("request", context);
    } else {
      logger.info("request", context);
    }
  });

  next();
};
