# Backend handoff

> Tour of the Bomboli backend as it stands today. Read this first when
> picking up the project. For architectural rationale see
> [`architecture.md`](./architecture.md); for the HTTP contract see
> [`api-reference.md`](./api-reference.md); for the original milestone
> plan see [`v1-roadmap.md`](./v1-roadmap.md).

---

## 1. What this service is

Bomboli is a hyper-local peer-to-peer marketplace for the DRC, launching as a Kinshasa pilot. This NestJS service is the **only** backend the Flutter mobile app talks to — the mobile client never touches Supabase directly. Supabase provides auth (issues JWTs the API validates), Postgres + PostGIS (primary store), Realtime (for chat in M7), and Storage (private buckets behind signed URLs). The service-role key lives only on the backend.

The application is a **modular monolith**. Every feature lives under `src/modules/<name>/` and follows the same three-layer split:

- **Controller** — HTTP only: parsing, validation, response shaping.
- **Service** — business rules, orchestration.
- **Repository** — sole owner of Prisma calls for that domain.

No raw Prisma queries leak into services; no business logic lives in controllers.

---

## 2. Repository layout

```
bomboli-server/
├── src/
│   ├── main.ts                 # HTTP entry — initialises Sentry, helmet, CORS, versioning, Zod pipe
│   ├── worker.ts               # Worker entry — same AppModule, no HTTP listener; BullMQ processors auto-start
│   ├── app.module.ts           # Wires everything: infra modules + domain modules + global guards/filters/interceptors
│   ├── config/                 # Zod-validated env, feature configs (app, database, redis, supabase, observability, payments)
│   ├── common/                 # Cross-cutting concerns (see §4)
│   ├── infrastructure/         # Platform modules (see §5) — all are global
│   └── modules/                # Domain modules (see §3)
├── prisma/
│   ├── schema.prisma           # Single source of truth for the DB
│   ├── migrations/             # 9 migrations covering M0–M6
│   └── seed.ts                 # 3 fixed test users (admin, buyer, seller) keyed by stable UUIDs
├── scripts/
│   ├── mint-test-jwt.ts        # `pnpm test:mint-jwt <admin|buyer|seller>` → HS256 token (24h)
│   ├── test-user-ids.ts        # Fixed UUIDs shared with seed + e2e
│   └── inspect-supabase-jwt.ts # Sign up against local Supabase, dump JWT structure
├── test/
│   ├── setup.ts                # Imports reflect-metadata for unit tests
│   └── e2e/                    # 8 e2e specs + helpers (app, db, jwt, mailpit, fixtures, supabase-cleanup)
├── supabase/config.toml        # Local Supabase stack (ports 54341–54347)
├── docker-compose.yml          # Redis only (Supabase has its own CLI-managed stack)
└── docs/                       # this directory
```

---

## 3. Domain modules

All listed endpoints exist and have e2e coverage unless noted. `(P)` = `@Public()`, otherwise authenticated. `(A)` = `@AdminOnly()`. `(I)` = idempotent (Idempotency-Key header). `(Aud)` = audited via `@Audited()`.

### `auth/` — Supabase auth bridge
- `POST /v1/auth/signup` `(P)` — email/password registration.
- `POST /v1/auth/login` `(P)` — email/password login.
- `POST /v1/auth/refresh` `(P)` — refresh access token.
- `POST /v1/auth/logout` — revoke refresh.
- `POST /v1/auth/email/verify`, `email/resend-verification` `(P)` — verification OTP flow.
- `POST /v1/auth/password/reset-request`, `password/reset` `(P)` — anti-enumeration password reset.
- `POST /v1/auth/oauth/exchange` `(P)` — swap Google/Apple id_token for Supabase session.
- `POST /v1/auth/phone-otp/send`, `phone-otp/verify` `(P)` — SMS OTP via Supabase.
- `POST /v1/internal/supabase/auth-hook` `(P, signature-gated)` — Supabase database webhook; upserts a local `User` row on auth.users INSERT/UPDATE. `SupabaseWebhookGuard` validates `Authorization: Bearer <SUPABASE_WEBHOOK_SECRET>`.

The HTTP-strategy at [src/modules/auth/strategies/supabase-jwt.strategy.ts](src/modules/auth/strategies/supabase-jwt.strategy.ts) validates HS256 JWTs against `SUPABASE_JWT_SECRET`, then loads the local `User` (JIT-creates if the webhook hasn't fired yet) and attaches `{ id, email, phone, isAdmin }` to `request.user`.

### `users/` — profile + sub-resources
- `GET/PATCH /v1/users/me` — profile (displayName, language, themePref, defaultLocation as PostGIS point).
- `POST /v1/users/me/avatar` — signed upload URL into `avatars` bucket.
- `addresses/` — `GET/POST /v1/users/me/addresses`, `PATCH/DELETE /:id`, `POST /:id/default`. PostGIS-stored points.
- `devices/` — `GET/POST/DELETE /v1/users/me/devices` (push token registration).
- `recently-viewed/` — `GET /v1/users/me/recently-viewed` (populated by listing-detail view tracking).

### `sellers/` — seller profile
- `GET /v1/sellers/:id` `(P)` — public profile.
- `GET /v1/sellers/me/profile` — caller's profile.
- `PUT /v1/sellers/me/profile` — idempotent create/update (any user becomes a seller by creating their profile).
- `POST /v1/sellers/me/profile/image` — signed upload for banner/hero.

### `listings/` — catalog
- `GET /v1/listings/:id` `(P, opportunistic Bearer)` — listing detail; if a Bearer is present the listing is added to recently-viewed.
- `GET /v1/listings/me/owned` — my listings.
- `POST /v1/listings` — create draft.
- `PATCH /v1/listings/:id` — update.
- `POST /v1/listings/:id/publish`, `archive` — lifecycle transitions.
- `DELETE /v1/listings/:id` — soft delete.
- `photos/` — `POST /v1/listings/:id/photos` (init signed upload), `POST /:id/photos/:photoId/commit` (confirm + enqueue image-processing job), `DELETE /:id/photos/:photoId`. The BullMQ processor at [src/modules/listings/photos/image-processing.processor.ts](src/modules/listings/photos/image-processing.processor.ts) generates sm/md/lg variants with `sharp`.

### `discovery/` — feed + search
- `GET /v1/feed?lat=&lng=&limit=` `(P, opportunistic Bearer)` — 6 rails: recently-viewed (auth-only), nearby (PostGIS), trending, new, seller promotions, categories.
- `GET /v1/search?q=&category=&lat=&lng=&limit=&offset=` `(P)` — full-text search (Postgres tsvector + pg_trgm fuzzy) with PostGIS distance and per-category radius caps from [src/common/geo/category-caps.ts](src/common/geo/category-caps.ts).

### `cart/` — single-seller cart
- `GET /v1/cart` — fetch.
- `POST /v1/cart/items`, `PATCH /v1/cart/items/:id`, `DELETE /v1/cart/items/:id` — item management.
- `POST /v1/cart/replace` — atomic clear-and-add for the "switch seller" confirmation flow.

Single-seller invariant: `Cart.sellerId` is locked on first add and nulled when the last item leaves. Currency is snapshotted from the first item.

### `orders/` — order lifecycle
- `POST /v1/orders` `(I)` — create from cart. Decrements inventory, snapshots prices, creates a `Payment` placeholder, clears the cart.
- `GET /v1/orders?status=&limit=&offset=` — paginated list.
- `GET /v1/orders/:id` — detail.
- `POST /v1/orders/:id/status` — forward transitions, seller-gated (PREPARING → ON_THE_WAY → DELIVERED).
- `POST /v1/orders/:id/cancel` — buyer or seller, status-aware.

The [orders.payment-listener.ts](src/modules/orders/orders.payment-listener.ts) subscribes to `payment.failed` on the global `EventEmitter` and cancels the order automatically.

### `payments/` — provider-agnostic payments
- `POST /v1/orders/:id/payment` `(I)` — initiate. Discriminated union body: `{ provider: 'STRIPE' | 'PAYPAL' | 'PAWAPAY' | 'MANUAL', ... }`. Returns a provider-specific `clientPayload` (Stripe `clientSecret`, PayPal `approveUrl`, Pawapay `depositId`).
- `GET /v1/payments/:id` — payment detail.
- `POST /v1/payments/:id/confirm` — client-driven capture (PayPal). Stripe/Pawapay are webhook-driven.
- **Admin:** `POST /v1/admin/payments/manual-confirm` `(A, Aud)`, `POST /v1/admin/payments/:id/refund` `(A, Aud)`.
- **Webhooks (all `@Public()`, signature-verified):** `POST /v1/internal/stripe/webhook`, `paypal/webhook`, `pawapay/webhook`. The webhook controller relies on `rawBody: true` (set in [main.ts](src/main.ts)) to verify signatures over the unparsed body.

Providers live behind [`PaymentProvider`](src/modules/payments/providers/payment-provider.interface.ts) and are selected via [`PaymentProviderRegistry`](src/modules/payments/providers/payment-provider.registry.ts). Stripe, PayPal, Pawapay, and Manual are all implemented end-to-end (create intent → webhook → refund).

### `deliverers/` — delivery roster
- `GET /v1/deliveries/me` — my deliverer profile (403 if no row exists).
- `PATCH /v1/deliveries/me/location` — push current GPS point.
- `PATCH /v1/deliveries/me/available` — toggle availability.
- **Admin:** `POST /v1/admin/deliverers` `(A, Aud)`, `GET /v1/admin/deliverers?onlyAvailable=true` `(A)`, `POST /v1/admin/orders/:id/assign-deliverer` `(A, Aud)` — synchronous assignment that computes distance + ETA via [src/common/geo/distance.ts](src/common/geo/distance.ts) (`etaFromDistanceKm`: 15 min/km, 5 min floor).

The pilot model is **admin-curated** — no self-service deliverer signup, no real-time dispatch.

### `health/` — probes + metrics
- `GET /v1/health` `(P)` — liveness, always 200.
- `GET /v1/health/ready` `(P)` — readiness; pings Postgres and Redis via `@nestjs/terminus`.
- `GET /v1/health/metrics` `(P, token-gated)` — Prometheus exposition. Token via `METRICS_TOKEN` env (required in production).

---

## 4. Cross-cutting concerns (`src/common/`)

| Concern | Lives at | Notes |
|---|---|---|
| Validation | [pipes/](src/common/pipes/) + Zod DTOs via `nestjs-zod` | Global `ZodValidationPipe` in `main.ts`. |
| Errors | [filters/all-exceptions.filter.ts](src/common/filters/all-exceptions.filter.ts) | Uniform `{ success: false, error: { code, message, ... } }`. Maps `DomainException`, `HttpException`, `ZodError`, Prisma `P2002`/`P2025`. 5xx flow to Sentry. |
| Correlation IDs | [middleware/correlation-id.middleware.ts](src/common/middleware/correlation-id.middleware.ts) | ULID per request, honors incoming `X-Correlation-Id`. |
| Auth guard | [guards/jwt-auth.guard.ts](src/common/guards/jwt-auth.guard.ts) | Global; opt out with `@Public()`. |
| Admin gating | [guards/roles.guard.ts](src/common/guards/roles.guard.ts) | Checks `user.isAdmin` when handler has `@AdminOnly()`. |
| Throttle | [guards/throttle.guard.ts](src/common/guards/throttle.guard.ts) | Keyed by `user.id`, falls back to IP. |
| Idempotency | [interceptors/idempotency.interceptor.ts](src/common/interceptors/idempotency.interceptor.ts) | Redis-backed dedupe on handlers decorated `@Idempotent()`. Client sends `Idempotency-Key`. TTL via `IDEMPOTENCY_TTL_HOURS` (default 24h). 409 on concurrent duplicate. |
| Audit | [interceptors/audit.interceptor.ts](src/common/interceptors/audit.interceptor.ts) + [`@Audited()`](src/common/decorators/) | Writes to `audit_logs` on successful execution of decorated handlers. |
| Response envelope | [interceptors/transform.interceptor.ts](src/common/interceptors/transform.interceptor.ts) | Wraps responses in `{ success, data, meta, pagination? }`. Auto-detects paginated payloads. |
| Logging / metrics | [interceptors/logging.interceptor.ts](src/common/interceptors/logging.interceptor.ts) + [metrics.interceptor.ts](src/common/interceptors/metrics.interceptor.ts) | Structured request logs + Prometheus counters/histograms. |
| Timeout | [interceptors/timeout.interceptor.ts](src/common/interceptors/timeout.interceptor.ts) | 30s default, configurable via `REQUEST_TIMEOUT_MS`. |
| Money | [common/money/currency.ts](src/common/money/currency.ts) | Always cents + ISO 4217; CDF (0 fraction) + USD (2). |
| Geo | [common/geo/](src/common/geo/) | Haversine, ETA, category radius caps. |
| i18n | [common/i18n/](src/common/i18n/) | Server emits French strings for v1. |

Global ordering of interceptors (set in [app.module.ts](src/app.module.ts)): Metrics → Logging → Idempotency → Audit → Transform → Timeout (outermost to innermost). The order matters — idempotency must short-circuit before audit records the action; transform wraps the response after audit; timeout wraps just the handler.

---

## 5. Infrastructure (`src/infrastructure/`)

Every infra module is `@Global()` and imported once from `AppModule`.

| Module | Provides | Notes |
|---|---|---|
| `database/` | `PrismaService` | Lazy-connects; logs queries in dev. |
| `redis/` | `RedisService` (ioredis client) | Shared by cache, jobs, idempotency. |
| `cache/` | `CacheService` (cache-manager + ioredis) | `get/set/del` with TTL. |
| `supabase/` | `SupabaseService` (anon) + `SupabaseAdminService` (service-role) | Admin client bypasses RLS — never expose. |
| `storage/` | `StorageService` | Wraps Supabase Storage. Buckets: `avatars`, `listing-photos`, `seller-banners`, `chat-attachments`, `verifications`. `ensureBuckets()` runs in dev/test only. Returns signed upload/read URLs. |
| `jobs/` | BullMQ queues | Named queues: `image-processing`, `notifications`, `aggregates`, `webhooks`, `reconciliation`. Default 3 retries with exponential backoff. Both API and worker import this module. |
| `audit/` | `AuditService` | Fire-and-forget DB writes (swallows errors to avoid breaking the request). |
| `logger/` | `nestjs-pino` setup | `pino-pretty` in dev, JSON in prod; redacts auth headers, cookies, tokens. |
| `observability/` | `MetricsService` (prom-client), `initSentry()` | Default system metrics, HTTP counter/histogram. Sentry initialises in `main.ts` and `worker.ts` **before** Nest bootstraps. |

---

## 6. Data model

Schema source: [prisma/schema.prisma](prisma/schema.prisma). Key things to know:

- **PostGIS** is enabled (`postgis`, `pg_trgm` extensions). `geography(Point, 4326)` is declared with `Unsupported(...)` and read/written via raw SQL inside repositories.
- **User** is buyer-by-default. `isAdmin: boolean` is the only escalation on the record. Selling is gated by the presence of `SellerProfile`; delivery by `Deliverer`. (UserRole enum was removed — commit `c071500`.)
- **Listing** has a generated `tsvector` column for full-text search, written by Postgres, never set from app code.
- **Cart** enforces the single-seller invariant via `sellerId` (locked on first item, nulled when empty).
- **Order** carries snapshots (`addressSnapshot`, `OrderItem.titleSnapshot/priceCentsSnapshot/photoUrlSnapshot`) so it survives address deletion and listing edits.
- **Payment** is 1:1 with Order. **PaymentAttempt** is an audit trail of every provider interaction (createIntent, confirm, webhook, refund).
- **SellerStats** is a materialized aggregate, written by the `aggregates` queue (M8 wiring; the table ships with zero defaults so seller-profile reads return a row before any reviews exist).
- **AuditLog** is the append-only target of `@Audited()`.

Migrations (chronological):
1. `20260520000000_init` — base schema.
2. `20260520000001_user_verification_fields` — `emailVerifiedAt`, `phoneVerifiedAt`, `lastSignInAt`.
3. `20260520000002_user_profile_addresses_devices` — M1.
4. `20260520000003_sellers_listings` — M2.
5. `20260520000004_search_indexes` — tsvector + GIST/GIN.
6. `20260520000005_carts_orders` — M4.
7. `20260520000006_payments` — M5.
8. `20260520000007_deliverers` — M6.
9. `20260522000000_drop_role_add_is_admin` — capability model migration.

---

## 7. Environment & local stack

Two service stacks boot independently:

- **Supabase** — managed by the Supabase CLI (`npx supabase start`). Ports 54341 (Kong API), 54342 (Postgres), 54343 (Studio), 54344 (Mailpit), 54347 (Analytics).
- **Redis** — managed by `docker-compose.yml`, port 6381. Standalone so it can be reset without touching the Postgres state.

`pnpm start:services` boots both. `.env.test` is the canonical local config; `.env.example` is the template for staging/prod (see [docs/local-development.md](./local-development.md) for the full walkthrough).

Required env vars (validated at boot by [src/config/env.validation.ts](src/config/env.validation.ts)): `NODE_ENV`, `PORT`, `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `SUPABASE_WEBHOOK_SECRET`, `REDIS_*`. Payment provider keys are optional — providers without keys are disabled.

---

## 8. Tests

E2E suites under [test/e2e/](test/e2e/) — one file per milestone:

| File | Covers |
|---|---|
| `auth.e2e-spec.ts` | Health, `users/me`, Supabase webhook provisioning. |
| `auth-proxy.e2e-spec.ts` | Signup → login → refresh → logout; password reset; OAuth exchange. |
| `profile.e2e-spec.ts` | Profile CRUD, avatar upload, addresses, devices, recently-viewed. |
| `catalog.e2e-spec.ts` | Seller profile, listing CRUD, photo upload + commit. |
| `discovery.e2e-spec.ts` | Geo search with category caps, feed rails. |
| `cart-orders.e2e-spec.ts` | Cart management, order creation, status transitions. |
| `payments.e2e-spec.ts` | Manual happy path, authorization, provider gating, refunds, webhook signatures. |
| `deliveries.e2e-spec.ts` | Admin deliverer creation, self endpoints, order assignment. |

E2E runs **sequentially** (`fileParallelism: false`) because they share the user table. Helpers in [test/e2e/helpers/](test/e2e/helpers/):
- `app.ts` — bootstraps the Nest app for supertest.
- `db.ts` — resets users/orders/listings between tests; preserves the 3 seed users.
- `jwt.ts` — `signSeedToken(role)`, `signCustomToken()`, `signExpiredToken()` against the test JWT secret.
- `supabase-cleanup.ts` — purges non-seed users from Supabase `auth.users` between files.
- `mailpit.ts` — polls the local SMTP capture (port 54344) and extracts OTPs for auth flows.
- `catalog-fixtures.ts` — distance-stratified geo points around Kinshasa for discovery testing.

Run: `pnpm test:e2e`. Unit tests (vitest) run with `pnpm test`.

---

## 9. Roadmap status (May 2026)

| Milestone | Status |
|---|---|
| M0 — Auth gap (Supabase webhook, JIT provisioning, RolesGuard, worker process, e2e foundation) | **Done** |
| M1 — Identity & profile (avatar, location, language, theme, addresses, devices, recently-viewed) | **Done** |
| M2 — Catalog (sellers, listings, photo pipeline, category radius caps) | **Done** |
| M3 — Discovery (full-text + fuzzy + proximity search, 6-rail feed) | **Done** |
| M4 — Cart + orders (single-seller invariant, status machine, atomic inventory, domain events) | **Done** |
| M5 — Payments (Stripe, PayPal, Pawapay, manual; webhook signature verification; admin refunds) | **Done** |
| M6 — Delivery scaffolding (admin roster, assignment, Haversine ETA, self-service location/availability) | **Done** |
| M7 — Messaging (Supabase Realtime, system messages on order events, unread counts) | Pending |
| M8 — Reviews & trust (sentiment tags, aggregation job → `SellerStats`, auto-approval, moderation) | Pending |
| M9 — Notifications (push via FCM/APNs, in-app feed, email via Resend, quiet hours) | Pending |
| M10 — Promos & wallet (promo codes, seller withdrawal — admin-only) | Pending |
| M11 — Admin API (full CRUD across all domains, audit log surface) | Pending |
| M12 — Production-readiness (test coverage, secrets, deploy host, TLS, Sentry tuning, rate-limit tuning, runbook) | Pending |

Pieces of M11 ship with each module above (e.g., `payments/admin/`, `deliverers/admin/` already exist). The pending work is to round it out and add the admin-only listing/order/user/promo/review/audit-log endpoints.

---

## 10. Things worth knowing before you change anything

- **`rawBody: true` is mandatory.** Payment webhooks verify signatures over the unparsed body. If you remove it, Stripe webhooks silently fail.
- **`@Public()` is opt-out, not opt-in.** The `JwtAuthGuard` is global; every new endpoint requires auth unless explicitly marked. Webhooks are `@Public()` but signature-gated (Supabase webhook uses `SupabaseWebhookGuard`; payment webhooks verify provider signatures in the handler).
- **Idempotency on writes.** `POST /v1/orders` and `POST /v1/orders/:id/payment` require `Idempotency-Key`. Don't remove the decorator.
- **Single-seller cart invariant.** The cart cannot mix sellers. The mobile client must call `/v1/cart/replace` (or DELETE then POST) to switch — don't paper over this in the API.
- **PostGIS goes through raw SQL.** Prisma marks geography columns `Unsupported`, so reads/writes use `prisma.$queryRaw`. Repositories own this — don't write geography from a service.
- **Capability model, not roles.** `isAdmin` is the only flag on `User`. Selling/delivering are gated by `SellerProfile`/`Deliverer` row presence. If you need to ask "is this user a seller?", look for the profile row, not a role.
- **Audit log is fire-and-forget.** If DB writes to `audit_logs` fail, the request still succeeds. That is intentional (audit must not break user-facing flows), but means audit gaps are silent — keep `@Audited()` on every admin/sensitive handler.
- **Worker shares the AppModule.** `worker.ts` boots the same module graph as `main.ts` without HTTP. Don't put BullMQ processors in a separate module that the API doesn't import — both processes must see them, even if only the worker runs them.
- **Sentry initialises before Nest.** It must, because process-level instrumentation needs to wrap the bootstrap. Don't move `initSentry()` inside the Nest lifecycle.

---

## 11. Where to start, depending on the next ticket

| You want to… | Start here |
|---|---|
| Add a new domain endpoint | Pick the nearest module under `src/modules/`. Follow the controller→service→repository split. |
| Add a queue job | Register the queue in [src/infrastructure/jobs/jobs.module.ts](src/infrastructure/jobs/jobs.module.ts) (or use an existing one), put the processor in the relevant feature module, ensure it's auto-loaded by `worker.ts`. |
| Add a new payment provider | Implement [`PaymentProvider`](src/modules/payments/providers/payment-provider.interface.ts), register it in the registry, add a webhook handler, extend the discriminated union in the payment DTO. |
| Implement chat (M7) | Supabase Realtime channel keyed by order; system messages emitted from `orders.events` listeners; persist read state per user. |
| Implement reviews (M8) | New `reviews` module + repository; aggregation processor pushes to `SellerStats`; gate posting by completed-order check. |
| Implement notifications (M9) | Subscribe `notifications` queue to the events orders/payments/reviews already emit; FCM + APNs + email transports behind a `Notifier` interface. |
| Add admin CRUD (M11) | Mirror the pattern in `src/modules/payments/admin/` and `src/modules/deliverers/admin/`. Always `@AdminOnly()` + `@Audited()`. |
| Production-ize (M12) | Coverage on the service layer, deploy target, log/metric scrape, rate-limit tuning, secrets rotation, runbook. |

---

## 12. Useful commands

```bash
# Services
pnpm start:services         # boot Supabase CLI + Redis
pnpm stop:services

# DB
pnpm test:db:migrate        # apply migrations against the local test DB
pnpm test:db:reset          # destroy + recreate the test DB
pnpm test:db:seed           # seed the 3 test users
pnpm prisma:studio          # GUI on the test DB

# Run
pnpm test:start:dev         # API with .env.test
pnpm test:start:worker:dev  # worker with .env.test

# Quality
pnpm typecheck
pnpm lint
pnpm test                   # unit
pnpm test:e2e               # e2e

# Tokens
pnpm test:mint-jwt admin    # → JWT signed with SUPABASE_JWT_SECRET, 24h
pnpm test:mint-jwt buyer
pnpm test:mint-jwt seller
```

Default ports: API 3002, Supabase Kong 54341, Postgres 54342, Studio 54343, Mailpit 54344, Redis 6381.
