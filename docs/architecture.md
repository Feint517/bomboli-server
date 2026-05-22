# Architecture

## API-first principle

The mobile client **never** talks to Supabase directly. The Supabase service-role key lives only in this backend. The mobile app authenticates against Supabase Auth, receives a JWT, and sends every request to NestJS — which validates the JWT and enforces business rules before touching the database.

```
                            ┌────────────────────────┐
                            │      Mobile app        │
                            │ (Flutter + Supabase    │
                            │  Auth)                 │
                            └───────────┬────────────┘
                                        │ Bearer JWT
                                        ▼
   ┌───────────────────────────────────────────────────────────────┐
   │                      Bomboli API (NestJS)                      │
   │ ┌──────────┐  ┌────────────┐  ┌────────────┐                  │
   │ │  Auth    │  │ Domain     │  │ Pipelines  │                  │
   │ │ (JWT)    │  │ modules    │  │ (filters,  │                  │
   │ └──────────┘  │ (later)    │  │  guards,   │                  │
   │               └────────────┘  │  pipes)    │                  │
   │                               └────────────┘                  │
   └─────────┬───────────┬─────────────────────────────────────────┘
             │           │
             ▼           ▼
        ┌────────┐  ┌─────────┐
        │Postgres│  │  Redis  │
        │(Supab.)│  │ (cache) │
        └────────┘  └─────────┘
```

## Layered modules

Every feature module follows the same layering:

- **Controller** — HTTP only (parsing, validation, response shaping).
- **Service** — orchestration and business rules. Calls repositories, queues, integrations.
- **Repository** — sole owner of Prisma/Supabase calls for that domain.

No raw Prisma or Supabase calls exist in services. No business logic lives in controllers.

## Cross-cutting concerns

| Concern | Owner |
|---|---|
| Validation | `ZodValidationPipe`, class-validator decorators |
| Errors | `AllExceptionsFilter` produces a uniform `{ success: false, error: {...} }` |
| Correlation IDs | `CorrelationIdMiddleware` (header `X-Correlation-Id`) |
| Logging | Pino via `nestjs-pino`, redacted secrets, structured JSON in prod |
| Throttling | `BomboliThrottleGuard` keyed by user ID |
| Auth | Global `JwtAuthGuard` with `@Public()` opt-out; HS256 against `SUPABASE_JWT_SECRET` |

## Why a modular monolith?

Microservices buy independent deploys and team autonomy at the cost of distributed-systems complexity. At Bomboli's launch scale (single team, no domain modules yet), the cost is not justified. The boundaries inside `src/modules/` are explicit enough that any module can graduate to a service later.

## Shipped modules

The foundation and core domain modules (M0–M6) are shipped:

- `auth` — Supabase JWT validation, login/signup/refresh proxy, phone OTP, Supabase auth webhook for JIT user provisioning.
- `users` — `/users/me`, addresses, devices, recently-viewed.
- `sellers` — public + owner profile, banner/hero upload.
- `listings` — CRUD, draft/published/archived lifecycle, photo upload pipeline (BullMQ → variants).
- `discovery` — `/feed` (6 rails) and `/search` (full-text + PostGIS proximity + category caps).
- `cart` — single-seller invariant, item management, atomic replace.
- `orders` — creation from cart, status machine, idempotent, payment-failure auto-cancel via event bus.
- `payments` — Stripe, PayPal, Pawapay, manual provider; webhook signature verification; admin refund/manual-confirm.
- `deliverers` — admin-curated roster, real-time location, ETA via Haversine, order assignment.
- `health` — liveness, readiness (Postgres + Redis), token-gated Prometheus metrics.

Pending milestones (M7–M12): chat, reviews, notifications, promos/wallet, admin surface, production hardening. See [`v1-roadmap.md`](./v1-roadmap.md) for detail, and [`handoff.md`](./handoff.md) for a concrete tour of what exists today.

## Capability model

Users are buyers by default. Additional capabilities are expressed by the **presence of profile rows**, not by a role enum:

- A user with a `SellerProfile` row can sell.
- A user with a `Deliverer` row can deliver.
- `User.isAdmin` is the only escalated permission on the user record itself.

(This replaced an earlier `UserRole` enum — see commit `c071500`.)

## Worker process

A second entry point (`src/worker.ts`) boots the same `AppModule` without an HTTP listener. BullMQ processors registered inside feature modules (e.g. image processing under listings) auto-start when the worker boots. Run with `pnpm start:worker:dev` locally.
