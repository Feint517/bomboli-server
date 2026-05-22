# Bomboli API

NestJS backend for **Bomboli** — a hyper-local peer-to-peer marketplace
for the Democratic Republic of Congo (Kinshasa pilot).

## Project status

All foundation and core domain milestones (M0–M6) are shipped: users,
sellers, listings, discovery, cart, orders, payments (Stripe, PayPal,
Pawapay, manual), and deliverers. Remaining roadmap work covers chat,
reviews, notifications, promos/wallet, admin surface, and production
hardening (M7–M12).

If you are a new developer picking up this project, start with
[`docs/handoff.md`](./docs/handoff.md) — it captures the layout, what
is implemented, and where to look for what.

## Documentation map

| Document | When to read it |
|---|---|
| [`docs/handoff.md`](./docs/handoff.md) | First read. Backend tour + module status + pending work. |
| [`docs/architecture.md`](./docs/architecture.md) | The architectural shape: layering, modules, cross-cutting concerns. |
| [`docs/local-development.md`](./docs/local-development.md) | Boot Supabase + Redis locally, run migrations, mint test JWTs. |
| [`docs/api-reference.md`](./docs/api-reference.md) | HTTP contract for every shipped endpoint (request/response shapes). |
| [`docs/v1-roadmap.md`](./docs/v1-roadmap.md) | Milestone plan. M0–M6 done; M7–M12 pending. |

## Quick start

```bash
pnpm install
pnpm start:services        # boots Redis + Supabase
pnpm test:db:migrate       # applies Prisma migrations
pnpm test:db:seed          # creates 3 test users (admin, buyer, seller)
pnpm test:start:dev        # API on http://localhost:3002
```

Health check:
```bash
curl -fsS http://localhost:3002/v1/health
curl -fsS http://localhost:3002/v1/health/ready
```

Mint a test JWT:
```bash
TOKEN=$(pnpm -s test:mint-jwt buyer)
```

Run the full test suite:
```bash
pnpm test          # unit
pnpm test:e2e      # e2e (auth, profile, catalog, discovery, cart-orders, payments, deliveries)
```

Full setup walkthrough: [`docs/local-development.md`](./docs/local-development.md).

## Stack

- Node 22 / pnpm 9
- NestJS 11 + Prisma 6 + Postgres 17 with PostGIS (via Supabase CLI)
- Redis (cache, BullMQ job queues, idempotency dedupe)
- Supabase Auth (HS256 JWT against `SUPABASE_JWT_SECRET`) + Supabase Storage (signed URLs)
- Stripe / PayPal / Pawapay (Mobile Money) / manual payment rails
- Pino logging, Sentry, Prometheus metrics, Helmet, compression
- Throttler keyed by user ID

## Ports

| Service | Port |
|---|---|
| Nest API | 3002 |
| Supabase Kong API | 54341 |
| Postgres | 54342 |
| Studio | 54343 |
| Mailpit | 54344 |
| Analytics | 54347 |
| Redis | 6381 |
