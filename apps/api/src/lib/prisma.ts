import { PrismaPg } from "@prisma/adapter-pg";

import { env, isProduction } from "../config/env";
import { PrismaClient } from "../generated/prisma/client";

/**
 * Prisma 7 removed the Rust query engine. Every database connection now goes
 * through a driver adapter, so the adapter is required rather than optional.
 * For PostgreSQL that is @prisma/adapter-pg, backed by node-postgres.
 */
const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

const createClient = (): PrismaClient => new PrismaClient({ adapter, log: ["warn", "error"] });

// `bun --watch` re-evaluates modules on change. Without a global cache each
// reload would open another connection pool until Postgres refused new ones.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();

if (!isProduction) {
  globalForPrisma.prisma = prisma;
}

/** Verify the database is reachable. Called once during startup. */
export async function assertDatabaseReachable(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
