import cors, { type CorsOptions } from "cors";
import express, { type Express } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";

import { corsOrigins, isTest } from "./config/env";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";

/**
 * CORS with an actual allowlist.
 *
 * The old configuration was `origin: (origin, callback) => callback(null, true)`
 * together with `credentials: true`, which reflects whatever Origin the caller
 * sends and tells the browser to trust it with credentials. That is equivalent
 * to disabling same-origin protection for every site on the internet.
 */
const corsOptions: CorsOptions = {
  origin(origin, callback) {
    // No Origin header: native mobile clients, curl, server-to-server. These
    // are not subject to the browser same-origin model, so allow them.
    if (!origin) {
      callback(null, true);
      return;
    }
    callback(null, corsOrigins.includes(origin));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};

export function createApp(): Express {
  const app = express();

  // Behind nginx. Required for rate limiting to see the real client IP rather
  // than the proxy's, which would otherwise pool every user into one bucket.
  app.set("trust proxy", 1);

  app.use(helmet());
  app.use(cors(corsOptions));

  // 1 MB is ample for JSON. Media goes through multipart upload, not base64 in
  // a request body, so the old 10 MB ceiling only widened the DoS surface.
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));

  if (!isTest) {
    app.use(
      rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 600,
        standardHeaders: "draft-7",
        legacyHeaders: false,
      }),
    );
  }

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", app: "ChatSaints", time: new Date().toISOString() });
  });

  // Feature routers mount here as they are ported.
  //
  // Note there is deliberately no `express.static("/uploads")` mount. The old
  // app served every uploaded file from an unauthenticated static path, above
  // all routers, so any voice note or photo was fetchable by URL with no token
  // and no conversation membership. Media will be served by an authenticated
  // route that verifies the caller can see the owning message or status.

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
