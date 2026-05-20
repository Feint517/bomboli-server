# Bomboli API

NestJS backend for **Bomboli** — a hyper-local peer-to-peer marketplace
for the Democratic Republic of Congo.

This is the **foundation scaffold**. Auth + health only; no domain
modules yet. See [`bomboli-backend-bootstrap.md`](./bomboli-backend-bootstrap.md)
for what is in scope, and [`docs/architecture.md`](./docs/architecture.md)
for the application architecture.

## Quick start

```bash
pnpm install
pnpm start:services        # boots Redis + Supabase
pnpm test:db:migrate       # applies init migration
pnpm test:db:seed          # creates 3 test users
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

Full setup walkthrough: [`docs/local-development.md`](./docs/local-development.md).

## Stack

- Node 22 / pnpm 9
- NestJS 11 + Prisma 6 + Postgres 17 (via Supabase CLI)
- Redis (cache only — no queues yet)
- Pino logging, Helmet, compression, throttler keyed by user ID
- HS256 JWT validation against `SUPABASE_JWT_SECRET`

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
