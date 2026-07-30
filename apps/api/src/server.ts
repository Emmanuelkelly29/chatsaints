import { createServer } from "node:http";

import { createApp } from "./app";
// Importing env first is what enforces configuration: a missing or malformed
// required variable exits here, before anything opens a socket.
import { env } from "./config/env";
import { disconnectRedis, getRedis } from "./config/redis";
import { describeError, logger } from "./lib/logger";
import { assertDatabaseReachable, disconnectPrisma } from "./lib/prisma";

const server = createServer(createApp());

async function start(): Promise<void> {
  try {
    await assertDatabaseReachable();
    logger.info("postgres connected");

    await getRedis();

    server.listen(env.PORT, () => {
      logger.info("api listening", {
        port: env.PORT,
        env: env.NODE_ENV,
        health: `http://localhost:${String(env.PORT)}/health`,
      });
    });
  } catch (error) {
    logger.error("startup failed", describeError(error));
    logger.error("check that PostgreSQL and Redis are running and that .env is correct");
    process.exit(1);
  }
}

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("shutting down", { signal });

  // Stop accepting connections, then release resources. Without awaiting the
  // close, in-flight requests are cut off mid-response.
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });

  await Promise.allSettled([disconnectPrisma(), disconnectRedis()]);
  logger.info("shutdown complete");
  process.exit(0);
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

process.on("unhandledRejection", (reason) => {
  logger.error("unhandled promise rejection", describeError(reason));
});

void start();
