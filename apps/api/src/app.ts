import cors, { type CorsOptions } from "cors";
import express, { type Express } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";

import { corsOrigins, isTest } from "./config/env";
import { adminRouter } from "./features/admin/routes";
import { announcementsRouter } from "./features/announcements/routes";
import { authRouter } from "./features/auth/routes";
import { callsRouter } from "./features/calls/routes";
import { contactRequestsRouter } from "./features/contact-requests/routes";
import { conversationsRouter } from "./features/conversations/routes";
import { e2eeRouter } from "./features/e2ee/routes";
import { geographyRouter } from "./features/geography/routes";
import { groupsRouter } from "./features/groups/routes";
import { leadersRouter } from "./features/leaders/routes";
import { mediaRouter } from "./features/media/routes";
import { meetingsRouter } from "./features/meetings/routes";
import { messagesRouter } from "./features/messages/routes";
import { missionaryRouter } from "./features/missionary/routes";
import { notificationsRouter } from "./features/notifications/routes";
import { poolRouter } from "./features/pool/routes";
import { reactionsRouter } from "./features/reactions/routes";
import { scripturesRouter } from "./features/scriptures/routes";
import { settingsRouter } from "./features/settings/routes";
import { statusesRouter } from "./features/statuses/routes";
import { usersRouter } from "./features/users/routes";
import { videoRouter } from "./features/video/routes";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { requestLogger } from "./middleware/requestLogger";
import { serializeResponse } from "./middleware/serializeResponse";

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

  // Before the rate limiters, so their 429s are logged too. They write their
  // own response and never reach the error handler.
  app.use(requestLogger);

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

  // Internally everything is camelCase; the wire stays snake_case, which is
  // what the Flutter client reads. Registered before the routers so every
  // response passes through it, including errors.
  app.use(serializeResponse);

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", app: "ChatSaints", time: new Date().toISOString() });
  });

  // ── Feature routers ────────────────────────────────────────────────────
  app.use("/api/auth", authRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/settings", settingsRouter);

  app.use("/api/conversations", conversationsRouter);
  // Registered before /api/messages so the nested reactions path is matched
  // by its own router rather than falling through.
  app.use("/api/messages/:id/reactions", reactionsRouter);
  app.use("/api/messages", messagesRouter);
  app.use("/api/groups", groupsRouter);

  app.use("/api/statuses", statusesRouter);
  app.use("/api/announcements", announcementsRouter);
  app.use("/api/notifications", notificationsRouter);

  app.use("/api/contact-requests", contactRequestsRouter);
  app.use("/api/ysa-pool", poolRouter);

  app.use("/api/geography", geographyRouter);
  app.use("/api/leaders", leadersRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/missionary", missionaryRouter);

  app.use("/api/calls", callsRouter);
  app.use("/api/video", videoRouter);
  app.use("/api/meetings", meetingsRouter);

  // Media is served by an authenticated route that checks the caller may see
  // the owning message or status. There is deliberately no
  // `express.static("/uploads")` mount: the old app served every uploaded file
  // from an unauthenticated static path, above all routers, so any voice note
  // or photo was fetchable by URL with no token and no conversation membership.
  app.use("/api/media", mediaRouter);

  // Public-key directory. Note this stores public keys only; nothing in the
  // application encrypts message bodies.
  app.use("/api/e2ee", e2eeRouter);

  app.use("/api/scriptures", scripturesRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
