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

## Foundation scope

This is the foundation. There are no domain modules yet — only `auth` (JWT validation) and `health`. The plan is to add listings, sellers, orders, payments, etc. as separate modules once the foundation is exercised end-to-end.
