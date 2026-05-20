# Local development

End-to-end reference for running the Bomboli server against a fully
local Supabase stack — first-time setup, daily workflow, stack
internals, and troubleshooting.

> The local stack uses well-known default credentials (anon key,
> service role key, JWT secret) that ship with the Supabase CLI. They
> are public knowledge — never reuse them in production.

> **Ports are remapped from Supabase defaults.** Bomboli is the third
> Supabase stack on this machine — UrbanFlow binds the defaults
> (54321-54324, 6379) and IncaCook binds 54331-54334+54337 plus 6380.
> Bomboli uses **54341-54344 + 54347** for Supabase, **6381** for
> Redis, and **3002** for the Nest API. `.env.test` is already wired to
> these.

---

## 1. Overview

The local stack is split across **two independent Docker Compose
projects** that run side by side. They look like one stack from the
app's perspective but live under separate Compose project labels:

| Project | Owner | Purpose |
|---|---|---|
| `bomboli-supabase` | Supabase CLI ([supabase/config.toml](../supabase/config.toml)) | Full Supabase BaaS: Postgres, auth, REST, storage, realtime, studio, mail, analytics |
| `bomboli-services` | Local [docker-compose.yml](../docker-compose.yml) | The app's auxiliary services (currently: Redis) |

They can't be merged into a single Compose project — the Supabase CLI
manages its own internal compose stack, and Compose v2 normalizes
project names to lowercase whereas the Supabase CLI does not, so the
two label spaces will never align. The naming convention above keeps
them visually distinct in Docker Desktop.

---

## 2. Prerequisites

| Tool | Min version | Install |
|---|---|---|
| **Docker Desktop** | running | https://www.docker.com/products/docker-desktop |
| **Supabase CLI** | 2.x | `brew install supabase/tap/supabase` |
| **Node.js** | 22+ | `nvm install 22` (project pins via `.nvmrc`) |
| **pnpm** | 9+ | `corepack enable pnpm` |

Verify:
```bash
docker ps          # no error → daemon is up
supabase --version
node --version
pnpm --version
```

---

## 3. Quick start

Already set up once before? Just:

```bash
pnpm start:services     # boots both stacks (idempotent)
pnpm test:start:dev     # boots the Nest API with .env.test
```

The API is now listening on http://localhost:3002 against the local
Supabase + Redis. If this is your first time, follow [§4](#4-first-time-setup) instead.

---

## 4. First-time setup

Run these once after cloning the repo (or after a fresh machine).

### 4.1 Install Node dependencies

```bash
pnpm install
```

### 4.2 Boot the local stacks

The `supabase/` config is committed to the repo. First boot downloads
~3 GB of Docker images and takes several minutes.

```bash
pnpm start:services
```

This runs `docker compose up -d` (Redis) then `npx supabase start`
(Supabase). `supabase status -o env` prints the credentials — the
local defaults already live in `.env.test`, so you don't normally need
to look at that output again.

### 4.3 Create `.env.test`

The file is gitignored. If you don't have one yet, copy the template
from [§11](#11-envtest-template).

### 4.4 Apply migrations to the local DB

```bash
pnpm test:db:migrate
```

This applies every migration in `prisma/migrations/` to the local
Postgres on port `54342`.

### 4.5 Storage buckets

The local Supabase ships without buckets. Bomboli has **no upload
flows yet**, so no buckets need to be created. When the first one is
needed, the SQL pattern is:

```bash
docker exec supabase_db_bomboli-supabase psql -U postgres -d postgres -c "
INSERT INTO storage.buckets (id, name, public) VALUES
  ('<bucket-name>', '<bucket-name>', <true|false>)
ON CONFLICT (id) DO NOTHING;"
```

Attach RLS policies via a migration.

### 4.6 Seed test users

```bash
pnpm test:db:seed
```

Creates three users:

| User | Role | supabaseId |
|---|---|---|
| `test+admin@bomboli.test` | ADMIN | `00000000-0000-0000-0000-000000000001` |
| `test+buyer@bomboli.test` | BUYER | `00000000-0000-0000-0000-000000000002` |
| `test+seller@bomboli.test` | SELLER | `00000000-0000-0000-0000-000000000003` |

The seed is idempotent — re-running wipes and recreates these three
users without touching anything else.

---

## 5. Daily workflow

### 5.1 Bring everything up

```bash
pnpm start:services            # idempotent — no-ops if already running
pnpm test:start:dev            # API with .env.test
```

The server is now listening on http://localhost:3002 with `.env.test`
loaded.

### 5.2 Mint test JWTs

```bash
TOKEN=$(pnpm -s test:mint-jwt buyer)
curl -H "Authorization: Bearer $TOKEN" http://localhost:3002/v1/health

# Other roles:
pnpm -s test:mint-jwt admin
pnpm -s test:mint-jwt seller
```

Tokens are signed with the **local** Supabase JWT secret and last 24 h.
Don't mix them with tokens minted against a remote `.env`.

### 5.3 Browse the local Postgres / Storage

- **Supabase Studio**: http://127.0.0.1:54343 — DB browser, storage UI
- **Mailpit**: http://127.0.0.1:54344 — local email inbox
- **Prisma Studio**: `pnpm prisma:studio` (against whichever env's
  `DATABASE_URL` is set; for test env prefix with `dotenv -e .env.test --`)

### 5.4 Reset state between tests

Two flavours:

```bash
# Fast — drops + recreates the public schema only
pnpm test:db:reset                         # `prisma migrate reset --force`

# Heavier — also resets storage, auth tables, etc.
supabase db reset                          # rebuilds the whole Supabase DB
pnpm test:db:migrate
pnpm test:db:seed
```

For most testing iterations `pnpm test:db:reset && pnpm test:db:seed`
is all you need.

---

## 6. Stack reference

### 6.1 Containers

#### `bomboli-supabase` (~12 containers, all prefixed `supabase_*`)

| Container | Image | Role |
|---|---|---|
| `supabase_db_bomboli-supabase` | `supabase/postgres:17.x` | Postgres database |
| `supabase_kong_bomboli-supabase` | `supabase/kong` | API gateway |
| `supabase_auth_bomboli-supabase` | `supabase/gotrue` | Auth service |
| `supabase_rest_bomboli-supabase` | `supabase/postgrest` | Auto-generated REST API |
| `supabase_realtime_bomboli-supabase` | `supabase/realtime` | Realtime subscriptions |
| `supabase_storage_bomboli-supabase` | `supabase/storage-api` | Object storage |
| `supabase_studio_bomboli-supabase` | `supabase/studio` | Web dashboard |
| `supabase_pg_meta_bomboli-supabase` | `supabase/postgres-meta` | Studio's schema browser |
| `supabase_edge_runtime_bomboli-supabase` | `supabase/edge-runtime` | Edge Functions runtime |
| `supabase_inbucket_bomboli-supabase` | `supabase/mailpit` | Captures outgoing email |
| `supabase_analytics_bomboli-supabase` | `supabase/logflare` | Studio logs/analytics |
| `supabase_vector_bomboli-supabase` | `supabase/vector` | Log shipper |

#### `bomboli-services`

| Container | Image | Role |
|---|---|---|
| `bomboli-redis` | `redis:7-alpine` | Cache backend |

### 6.2 Ports

| Service | Bomboli | Supabase default | URL |
|---|---|---|---|
| Supabase API (Kong) | 54341 | 54321 | http://127.0.0.1:54341 |
| Postgres | 54342 | 54322 | `postgresql://postgres:postgres@127.0.0.1:54342/postgres` |
| Postgres shadow | 54340 | — | (used by `prisma migrate dev`) |
| Studio | 54343 | 54323 | http://127.0.0.1:54343 |
| Mailpit (Inbucket) | 54344 | 54324 | http://127.0.0.1:54344 |
| Analytics | 54347 | 54327 | http://127.0.0.1:54347 |
| Redis | 6381 | 6379 | `redis://127.0.0.1:6381` |
| Nest API (dev) | 3002 | — | http://127.0.0.1:3002 |

### 6.3 Volumes

| Volume | Stack | Contains |
|---|---|---|
| `supabase_db_bomboli-supabase` | supabase | Full Postgres data dir |
| `supabase_storage_bomboli-supabase` | supabase | Uploaded objects |
| `bomboli-services_bomboli-redis-data` | services | Redis AOF/RDB |

---

## 7. Stopping & teardown

### 7.1 Stop the API server

```bash
# In the terminal running `pnpm test:start:dev`, press Ctrl+C.
# If it's in the background:
pkill -f "nest start --watch"
```

### 7.2 Stop both stacks (keep data)

```bash
pnpm stop:services
```

### 7.3 Wipe Postgres without touching anything else

```bash
supabase db reset
pnpm test:db:seed
```

### 7.4 Wipe Redis

```bash
docker exec bomboli-redis redis-cli FLUSHALL
```

### 7.5 Full teardown (rare — only when freeing disk space)

```bash
pkill -f "nest start --watch"
supabase stop --no-backup
docker compose down -v
```

---

## 8. Troubleshooting

### `pnpm test:start:dev` exits with `ECONNREFUSED ::1:6381`

Redis isn't running. Start it:
```bash
pnpm start:services
```

### `Can't reach database server at 127.0.0.1:54342`

Supabase isn't running. Run `pnpm start:services` (or just `supabase start`).

### `pnpm start:services` hangs on Supabase health checks

Stale containers from a crashed run. Reset with:
```bash
supabase stop --no-backup
pnpm start:services
```

### Port already in use on start

Another project (UrbanFlow or IncaCook) is binding a default port.
Check with `lsof -i :<port>`.

### Auth emails not arriving

Mailpit is the local sink for everything outgoing. Open
http://127.0.0.1:54344 — no email actually leaves the machine.

### Migration failed with a stuck "applied: false" row

Roll back the failed migration record so it can be retried:
```bash
dotenv -e .env.test -- prisma migrate resolve --rolled-back <migration_name>
```

---

## 9. pnpm scripts cheat sheet

| Script | What it does |
|---|---|
| `pnpm start:services` | `docker compose up -d && npx supabase start` — boots both stacks |
| `pnpm stop:services` | `docker compose down && npx supabase stop` — stops both stacks |
| `pnpm test:start:dev` | Start the API with `.env.test` in watch mode |
| `pnpm test:db:migrate` | Apply all migrations to local DB |
| `pnpm test:db:reset` | Drop + recreate public schema; reapply migrations |
| `pnpm test:db:seed` | Seed the 3 test users |
| `pnpm test:mint-jwt <role>` | Mint a local-test JWT (admin/buyer/seller) |
| `pnpm prisma:studio` | Prisma Studio against the env Prisma loads (`.env`) |

---

## 10. Related docs

- [architecture.md](./architecture.md) — application architecture

---

## 11. `.env.test` template

If you're recreating `.env.test` from scratch, this is the working template:

```bash
NODE_ENV=test
PORT=3002
APP_URL=http://localhost:3002
APP_NAME=bomboli-api
ALLOWED_ORIGINS=http://localhost:3002,http://localhost:8081

# Local Supabase Postgres
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54342/postgres
DIRECT_URL=postgresql://postgres:postgres@127.0.0.1:54342/postgres

# Local Supabase (CLI defaults — public, never use in prod)
SUPABASE_URL=http://127.0.0.1:54341
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU
SUPABASE_JWT_SECRET=super-secret-jwt-token-with-at-least-32-characters-long

# Redis
REDIS_URL=redis://localhost:6381
REDIS_HOST=localhost
REDIS_PORT=6381

# JWT
JWT_SECRET=local-test-jwt-secret-not-for-production-use-32+chars
JWT_EXPIRATION=7d

# Rate limiting
RATE_LIMIT_TTL=60
RATE_LIMIT_MAX=1000
```
