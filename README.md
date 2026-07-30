# ChatSaints

Chat and community app for Latter-day Saint young single adults, with a
hierarchy-aware directory, group messaging, calls, statuses, announcements and
meetings.

Two applications live in this repository:

| Path | What it is | Stack |
| --- | --- | --- |
| `apps/api` | REST + WebSocket backend | TypeScript, Express 5, Prisma 7, PostgreSQL, Redis |
| `apps/mobile` | Mobile and web client | Flutter 3.44 / Dart 3.12 |

Supporting directories:

| Path | Contents |
| --- | --- |
| `infra/` | nginx reverse proxy config and container setup |
| `docs/` | setup, release and operational guides |
| `.github/workflows/` | CI and deployment pipelines |

The two applications share no code. They communicate only over HTTP and
WebSocket, so each is developed and released independently.

## Prerequisites

- [Bun](https://bun.sh) 1.3+ (package manager and runtime for the API)
- PostgreSQL 16+ (Postgres.app or Homebrew both work)
- Redis 7+
- [Flutter](https://docs.flutter.dev/install) 3.44+ (only needed for `apps/mobile`)

## First-time setup

```bash
bun run install:all           # installs API deps and Flutter packages

cp apps/api/.env.example apps/api/.env
#   then fill in DATABASE_URL, JWT_SECRET and SMTP_* with real values

bun run db:migrate            # creates the schema and generates the client
bun run db:seed               # loads scripture data and reference geography
```

The API refuses to start if a required environment variable is missing, so a
misconfigured `.env` fails immediately and loudly rather than at first request.

## Everyday commands

Run these from the repository root.

| Command | Does |
| --- | --- |
| `bun run dev` | Start the API with reload |
| `bun run check` | Typecheck, lint and test in one pass |
| `bun run test` | API tests only |
| `bun run mobile:dev` | Run the Flutter client |
| `bun run mobile:analyze` | Static analysis on the Flutter client |

## Changing the database

The Prisma schema at `apps/api/prisma/schema.prisma` is the single source of
truth. Never hand-write SQL and never edit a file under `prisma/migrations/`.

```bash
# 1. edit apps/api/prisma/schema.prisma
# 2. generate and apply the migration, and refresh the client
bun run db:migrate
```

`db:migrate` runs `prisma migrate dev` followed by `prisma generate`. Prisma 7
no longer chains those two steps, so the script pairs them for you. Prisma
writes the migration SQL itself by diffing your schema against a temporary
shadow database.

In production, apply already-generated migrations without creating new ones:

```bash
bun run db:deploy
```

| Command | Does |
| --- | --- |
| `bun run db:migrate` | Create and apply a migration, then regenerate the client |
| `bun run db:deploy` | Apply pending migrations (production) |
| `bun run db:generate` | Regenerate the Prisma client only |
| `bun run db:reset` | Drop, recreate and re-seed the local database |
| `bun run db:studio` | Browse the database in Prisma Studio |

The generated client lands in `apps/api/src/generated/` and is deliberately not
committed. After a fresh clone it does not exist yet, so run `bun run
db:generate` (or `db:migrate`, which includes it) before the first typecheck.

## Configuration

Every setting is read from `apps/api/.env`. See `apps/api/.env.example` for the
full list with explanatory comments. Nothing in this repository should ever
contain a real credential; `.gitignore` and a secret-scanning pre-commit hook
both guard against it.
