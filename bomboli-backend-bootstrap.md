# Bomboli backend — bootstrap brief

> Handoff to Claude Code. Goal: scaffold the **foundation + local testing
> environment** for a new NestJS backend at
> `~/projects/Bomboli/bomboli-server`. **Foundation only** — no domain
> modules yet (auth/health only). Follow the IncaCook reference repo
> closely; differences below are deliberate.

---

## 1. Product context

The product is **Bomboli**, a hyper-local peer-to-peer marketplace for
the Democratic Republic of Congo (French UI, currently frontend-only
Flutter app with all data mocked). Read **PRODUCT.md** in the frontend
repo for the full picture; the short version:

- **Three roles**: *Client* (buyer), *Vendeur* (seller, currently named
  `cuisinier` in the legacy auth scaffold — known cleanup), and
  *Livreur* (delivery partner, mostly placeholder).
- **Six categories** with per-category proximity caps (15–30 km):
  `cosmetique`, `textile`, `secondeMain`, `agricole`, `services`,
  `autres`.
- **Trust-heavy seller profile**: ratings, hygiene/quality/packaging
  bars, verifications checklist, sentiment-tagged reviews.
- **Payments**: PayPal + phone credit (Vodafone etc.), Stripe planned.
- **Single-seller-per-cart**, three-stage order tracker
  (*Préparée → En route → Livrée*).

**At this bootstrap stage we don't model any of this.** Just stand up
the scaffold. Domain modules (listings, orders, sellers, etc.) come in
follow-up work.

---

## 2. Reference repo

`~/projects/IncaCook/incacook-server` is the pattern source. Mirror its
shape and conventions one-for-one *unless this brief overrides it*.
Files worth reading first:

- `docker-compose.yml` — Redis service shape
- `supabase/config.toml` — Supabase CLI config + port remapping
- `package.json` — scripts, deps, engines pins
- `src/main.ts`, `src/app.module.ts` — bootstrap shape
- `src/config/env.validation.ts` — Zod env schema
- `src/common/` — filters/guards/interceptors/middleware/pipes
- `src/infrastructure/` — database, redis, cache, queue, supabase, storage, logger
- `docs/local-development.md` — the workflow this new repo should also support
- `docs/architecture.md` — the modular-monolith pattern to mirror

---

## 3. Port assignments (three-way coexistence)

This machine already runs **two** Supabase stacks. Bomboli is the
third — pick a clean band so nothing collides.

| Service | UrbanFlow | IncaCook | **Bomboli** |
|---|---|---|---|
| Supabase API (Kong) | 54321 | 54331 | **54341** |
| Postgres | 54322 | 54332 | **54342** |
| Studio | 54323 | 54333 | **54343** |
| Mailpit (Inbucket) | 54324 | 54334 | **54344** |
| Analytics | 54327 | 54337 | **54347** |
| Postgres shadow | — | 54330 | **54340** |
| Redis | 6379 | 6380 | **6381** |
| Nest API (dev) | — | 3001 | **3002** |

All of these need to be reflected in `supabase/config.toml`,
`docker-compose.yml`, and `.env.test`.

---

## 4. Repo layout to create

```
~/projects/Bomboli/bomboli-server/
├── .env.test                       # gitignored, template in §10
├── .env.example                    # committed, no secrets
├── .gitignore
├── .nvmrc                          # 22
├── .npmrc
├── .prettierrc
├── Dockerfile                      # multi-stage, mirror IncaCook
├── docker-compose.yml              # Redis-only (Supabase managed by CLI)
├── eslint.config.mjs
├── nest-cli.json
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── tsconfig.build.json
├── vitest.config.ts
├── README.md
├── docs/
│   ├── architecture.md             # adapt from IncaCook, slim to foundation
│   └── local-development.md        # adapt from IncaCook, change ports/names
├── prisma/
│   ├── schema.prisma               # User + UserRole enum only (see §7)
│   ├── migrations/                 # first migration applied during setup
│   └── seed.ts                     # 3 test users: buyer/seller/admin
├── scripts/
│   └── mint-test-jwt.ts            # signs a local Supabase JWT for the seeded users
├── supabase/
│   └── config.toml                 # project_id = "bomboli-supabase", ports per §3
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── common/
│   │   ├── filters/
│   │   │   └── all-exceptions.filter.ts
│   │   ├── guards/
│   │   │   ├── jwt-auth.guard.ts
│   │   │   ├── roles.guard.ts
│   │   │   └── throttle.guard.ts
│   │   ├── interceptors/
│   │   │   ├── logging.interceptor.ts
│   │   │   ├── timeout.interceptor.ts
│   │   │   └── transform.interceptor.ts
│   │   ├── middleware/
│   │   │   └── correlation-id.middleware.ts
│   │   ├── decorators/             # @Public(), @CurrentUser(), @Roles()
│   │   ├── pipes/                  # ZodValidationPipe wrapper
│   │   └── types/                  # AuthenticatedUser, etc.
│   ├── config/
│   │   ├── config.module.ts
│   │   ├── env.validation.ts       # Zod schema — strip IncaCook-specific keys
│   │   ├── app.config.ts
│   │   ├── database.config.ts
│   │   ├── redis.config.ts
│   │   └── supabase.config.ts
│   ├── infrastructure/
│   │   ├── database/               # PrismaService + DatabaseModule (global)
│   │   ├── redis/                  # ioredis client provider (global)
│   │   ├── cache/                  # cache-manager + ioredis-yet (global)
│   │   ├── logger/                 # nestjs-pino setup
│   │   └── supabase/               # @supabase/supabase-js client (service-role)
│   └── modules/
│       ├── auth/                   # JWT validation against Supabase JWT secret
│       └── health/                 # /v1/health (+ /v1/health/ready)
└── test/
    ├── setup.ts
    └── e2e/
        └── vitest-e2e.config.ts
```

**Deliberately omitted from this scaffold** (IncaCook has them; Bomboli
doesn't need them yet): BullMQ queue infra, Stripe, Twilio, FCM, Resend,
Mapbox, audit module, storage module, worker process (`worker.ts`).
Leave hooks where adding them later is cheap, but **don't import deps**
for them. We'll pull each in when we wire its first domain module.

---

## 5. Stack

| Layer | Pin | Notes |
|---|---|---|
| Runtime | Node 22 (`.nvmrc`) | `engines.node: ">=22.0.0"` |
| Package manager | pnpm 9.15.0 | `packageManager` field + corepack |
| Framework | NestJS 11 | `@nestjs/{common,core,config,platform-express,jwt,passport,terminus,throttler,event-emitter,schedule}` |
| DB | Prisma 6 + Postgres 17 | via Supabase CLI |
| Validation | `zod` + `class-validator` + `class-transformer` + `nestjs-zod` |
| Auth | `passport-jwt` validating Supabase HS256 JWTs (secret from `SUPABASE_JWT_SECRET`) |
| Cache/Redis | `ioredis` + `cache-manager` + `cache-manager-ioredis-yet` |
| Logging | `nestjs-pino` + `pino-http` + `pino-pretty` (dev only) |
| Security | `helmet`, `compression`, `cookie-parser` |
| Testing | `vitest` + `supertest` + `@nestjs/testing` |
| Lint/format | `eslint` 9 (flat config) + `prettier` 3 + `husky` + `lint-staged` |

**Do not** add: bullmq, stripe, twilio, firebase-admin, resend, sentry,
mapbox, socket.io. Those land with their respective modules later.

---

## 6. Architecture conventions (mirror IncaCook)

- **Layered modules**: `controller` → `service` → `repository`. Only
  repositories touch Prisma/Supabase.
- **Global infra modules**: `DatabaseModule`, `RedisModule`,
  `CacheModule`, `SupabaseModule`, `LoggerModule` — registered once in
  `AppModule`.
- **Global ValidationPipe**: `whitelist: true`, `forbidNonWhitelisted:
  true`, `transform: true`.
- **URI versioning**: every route under `/v1/...`
  (`enableVersioning({ type: VersioningType.URI, defaultVersion: '1' })`).
- **CORS**: driven by `ALLOWED_ORIGINS` env (comma-split).
- **Global JWT guard** with a `@Public()` opt-out decorator. Health
  endpoints are `@Public()`.
- **Global throttler** keyed by user id (per-user, not per-IP). Mirror
  `IncaCookThrottleGuard` → rename to `BomboliThrottleGuard`.
- **Uniform error envelope**: `{ success: false, error: { code, message, details? } }` via `AllExceptionsFilter`.
- **Uniform success envelope**: `{ success: true, data }` via `TransformInterceptor`.
- **Correlation IDs**: `X-Correlation-Id` middleware, surfaced in logs.
- **TS path aliases**: `@common/*`, `@config/*`, `@infrastructure/*`,
  `@modules/*` (matches IncaCook `tsconfig.json` and `nest-cli.json`).

---

## 7. Initial Prisma schema

Keep it deliberately minimal so we're not committing to a domain shape
yet. Just enough to validate the auth + JWT flow end-to-end.

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}

enum UserRole {
  BUYER
  SELLER
  ADMIN
}

model User {
  id          String   @id @default(cuid())
  supabaseId  String   @unique
  email       String   @unique
  phone       String?  @unique
  role        UserRole @default(BUYER)
  displayName String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@map("users")
}
```

Generate the first migration via `prisma migrate dev --name init`.

---

## 8. Docker / Supabase setup

### `docker-compose.yml`

Copy from IncaCook, rename:

```yaml
name: bomboli-services

services:
  redis:
    image: redis:7-alpine
    container_name: bomboli-redis
    ports:
      - '6381:6379'
    volumes:
      - bomboli-redis-data:/data
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 5s
      timeout: 3s
      retries: 5

volumes:
  bomboli-redis-data:
```

### `supabase/config.toml`

Run `supabase init` inside the repo, then edit:

- `project_id = "bomboli-supabase"`
- `[api] port = 54341`
- `[db] port = 54342`, `shadow_port = 54340`, `major_version = 17`
- `[studio] port = 54343`
- `[inbucket] port = 54344`
- `[analytics] port = 54347`
- `[auth] site_url = "http://127.0.0.1:3002"`
- `[auth] additional_redirect_urls = ["https://127.0.0.1:3002"]`
- `[auth.email] enable_confirmations = false` (dev convenience)
- Leave Google/Apple OAuth disabled. We'll enable on demand.

### Storage buckets

The local Supabase ships without buckets. Don't pre-create any — we
have no upload flows yet. Document the SQL pattern in
`docs/local-development.md` for future buckets.

---

## 9. `package.json` scripts (minimum)

```jsonc
{
  "scripts": {
    "build": "nest build",
    "start": "nest start",
    "start:dev": "nest start --watch",
    "start:debug": "nest start --debug --watch",
    "start:prod": "node dist/main.js",
    "start:services": "docker compose up -d && npx supabase start",
    "stop:services": "docker compose down && npx supabase stop",
    "lint": "eslint \"src/**/*.ts\" --fix",
    "lint:check": "eslint \"src/**/*.ts\"",
    "format": "prettier --write \"src/**/*.ts\" \"test/**/*.ts\"",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --passWithNoTests",
    "test:watch": "vitest --watch",
    "test:e2e": "vitest run --config ./test/e2e/vitest-e2e.config.ts --passWithNoTests",
    "prisma:generate": "prisma generate",
    "prisma:migrate:dev": "prisma migrate dev",
    "prisma:migrate:deploy": "prisma migrate deploy",
    "prisma:studio": "prisma studio",
    "prisma:seed": "tsx prisma/seed.ts",
    "test:db:migrate": "dotenv -e .env.test -- prisma migrate deploy",
    "test:db:reset": "dotenv -e .env.test -- prisma migrate reset --force",
    "test:db:seed": "dotenv -e .env.test -- tsx prisma/seed.ts",
    "test:start:dev": "dotenv -e .env.test -- nest start --watch",
    "test:mint-jwt": "tsx --env-file=.env.test scripts/mint-test-jwt.ts",
    "prepare": "husky || true"
  }
}
```

---

## 10. `.env.test` template

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

`.env.example` should hold the same keys with values blanked (`=`).

---

## 11. Seed (`prisma/seed.ts`)

Idempotent — wipe-and-recreate three users:

| Email | Role | supabaseId |
|---|---|---|
| `test+admin@bomboli.test` | `ADMIN` | `00000000-0000-0000-0000-000000000001` |
| `test+buyer@bomboli.test` | `BUYER` | `00000000-0000-0000-0000-000000000002` |
| `test+seller@bomboli.test` | `SELLER` | `00000000-0000-0000-0000-000000000003` |

The seed should `deleteMany` then `createMany` so it's safely re-runnable.

---

## 12. `mint-test-jwt.ts`

CLI that takes a role argument (`admin` | `buyer` | `seller`), reads
the matching `supabaseId` from the seed list, and signs an HS256 JWT
with `SUPABASE_JWT_SECRET`:

```ts
{
  sub: "<supabaseId>",
  role: "authenticated",
  aud: "authenticated",
  iat: now,
  exp: now + 24h,
  // app-side custom claims (read in JwtStrategy):
  app_role: "BUYER" | "SELLER" | "ADMIN",
  email: "<seeded email>",
}
```

Print only the token to stdout so it composes with shell pipelines:
`TOKEN=$(pnpm -s test:mint-jwt buyer)`.

---

## 13. Auth module shape (slim)

- `JwtStrategy` (passport): verify HS256 against `SUPABASE_JWT_SECRET`,
  validate `aud === 'authenticated'`, look up the local `User` by
  `supabaseId`, attach to `req.user`. Reject if no local user row.
- `JwtAuthGuard` registered globally via `APP_GUARD`. Use a `@Public()`
  decorator (sets a `isPublic` metadata key) to opt-out — health
  endpoints are public.
- `RolesGuard` reads `@Roles('ADMIN', 'SELLER')` metadata and compares
  against `req.user.role`.
- **No signup/login endpoints in this bootstrap.** Auth happens on the
  Supabase side (the future Flutter client calls Supabase Auth
  directly). The backend only *validates* incoming JWTs. We'll add
  the auth-flow endpoints (`/v1/auth/signup`, OTP verification, OAuth
  exchange) in a follow-up.

---

## 14. Health module

Two routes, both `@Public()`:

- `GET /v1/health` — liveness, returns `{ status: 'ok', uptime, env }`
- `GET /v1/health/ready` — readiness, uses `@nestjs/terminus` to ping
  Prisma (`SELECT 1`) and Redis (`PING`). Returns 503 if either fails.

---

## 15. Adapt `docs/local-development.md`

Adapt the IncaCook doc, changing every:

- `incacook` → `bomboli`
- `IncaCook` → `Bomboli`
- Port 3001 → 3002
- Port 6380 → 6381
- Supabase ports 54331-54334+54337 → 54341-54344+54347
- Project labels `incacook-services` / `incacook-supabase` →
  `bomboli-services` / `bomboli-supabase`

Trim the §4.5 storage-bucket section to a placeholder ("no buckets
yet"). Drop §5.3 (email OTP — auth not wired). Drop the Stripe
troubleshooting block. Keep everything else (it documents the *pattern*,
which is shared).

---

## 16. Acceptance criteria

When the scaffold is done, all of the following must pass on a fresh
clone:

```bash
pnpm install
pnpm start:services                  # boots Redis + Supabase
pnpm test:db:migrate                 # applies init migration
pnpm test:db:seed                    # creates 3 users
pnpm typecheck                       # zero errors
pnpm lint:check                      # zero errors
pnpm test                            # passes (no tests yet → --passWithNoTests)
pnpm test:start:dev &                # API up on :3002

# Health (public):
curl -fsS http://localhost:3002/v1/health
curl -fsS http://localhost:3002/v1/health/ready

# Unauthenticated request rejected:
curl -i http://localhost:3002/v1/users/me      # → 404 (route not mounted yet) is fine
# But anything mounted MUST 401 without a token.

# Authenticated request accepted:
TOKEN=$(pnpm -s test:mint-jwt buyer)
echo "$TOKEN" | grep -q .              # token non-empty
```

Then check the Docker/Supabase plumbing:

- `docker ps` shows `bomboli-redis` + 12 `supabase_*_bomboli-supabase` containers
- Mailpit reachable at http://127.0.0.1:54344
- Studio reachable at http://127.0.0.1:54343, showing the `users` table

And the static surface:

- No imports of stripe, twilio, firebase-admin, resend, bullmq, mapbox,
  sentry, socket.io anywhere
- `src/main.ts` calls `app.enableVersioning`, `app.useGlobalPipes(new
  ValidationPipe(...))`, `app.use(helmet())`, `app.use(compression())`,
  `app.useLogger(app.get(PinoLogger))`, `app.enableShutdownHooks()`
- `.env.test` is gitignored, `.env.example` is committed

---

## 17. Ground rules for the implementing agent

- **Don't invent domain.** Listings, sellers, orders, payments etc.
  are **not** in scope. If a layout decision implies one, leave a
  placeholder file or skip it.
- **Don't copy IncaCook business config.** Strip
  `COMMISSION_PERCENTAGE_*`, `DELIVERY_FEE_EUROS`,
  `LE_BON_FAIT_MAISON_PRICE_CAP`, and anything else IncaCook-specific
  out of `env.validation.ts`.
- **Don't mock anything in services.** No fake adapters, no TODO
  stubs that return hardcoded data. If a piece isn't ready, omit it.
- **Don't add backwards-compat shims** for hypothetical future moves
  (microservices split, etc.).
- **Confirm before destructive actions** — there should be none in
  this bootstrap, but if anything in `~/projects/Bomboli/bomboli-server`
  already exists, ask before overwriting.
- **One commit per milestone**, suggested splits:
  1. `chore: scaffold NestJS app + tsconfig + lint + prettier`
  2. `chore(docker): add Redis compose + Supabase CLI config`
  3. `feat(infra): wire Prisma, Redis, cache, Supabase, logger modules`
  4. `feat(auth): JWT strategy + global guard + @Public decorator`
  5. `feat(health): liveness + readiness endpoints`
  6. `chore(seed): initial User model + 3-user idempotent seed`
  7. `docs: local-development.md + architecture.md`
