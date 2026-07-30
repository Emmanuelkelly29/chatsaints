import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Prisma 7 moved the database connection out of schema.prisma and into this
// file. schema.prisma now describes only the data model.
export default defineConfig({
  schema: "prisma/schema.prisma",

  migrations: {
    path: "prisma/migrations",
    seed: "bun run prisma/seed.ts",
  },

  datasource: {
    url: env("DATABASE_URL"),

    // Prisma diffs your schema against a throwaway shadow database to write
    // migration SQL for you. Locally it creates and drops that database
    // itself, so this stays unset. Set it only on managed Postgres where the
    // application user lacks CREATE DATABASE, otherwise `migrate dev` fails
    // and you end up hand-writing SQL.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
