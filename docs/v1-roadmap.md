# Bomboli backend — v1 roadmap

> Follow-up to [`bomboli-backend-bootstrap.md`](../bomboli-backend-bootstrap.md).
> The bootstrap scaffolded the foundation (auth validation + health). This
> document plans every domain module needed to replace the Flutter mocks
> end-to-end and ship a **Kinshasa pilot** with a small seller cohort.
>
> Companion reading:
> - [`docs/architecture.md`](./architecture.md) — modular-monolith pattern
> - [`docs/local-development.md`](./local-development.md) — local workflow
> - [`../bomboli-app/PRODUCT.md`](../../bomboli-app/PRODUCT.md) — product surface to match

---

## 0. Guiding principles

- **Pilot ≠ scale.** Favor admin tools + manual reconciliation over automation.
  KYC, deliverer assignment, payment matching, review moderation all start
  manual.
- **Mirror the Flutter contract.** Every endpoint mirrors a screen that already
  exists in `bomboli-app` with mocked data. Replace mocks one rail at a time;
  don't reshape the UI.
- **French + DRC realities baked in.** Error envelopes carry French messages,
  currency is CDF with USD shadow pricing where relevant, phones in E.164 with
  +243 default, timezone `Africa/Kinshasa`.
- **Modular monolith, no microservices.** Keep IncaCook's layering
  (controller → service → repository) and the global infra modules already wired.
- **Storage and jobs land early.** The bootstrap doc defers BullMQ and Storage;
  we need both starting in M0/M2 — image thumbnails, notification fan-out,
  aggregate recomputation, deferred sends.
- **One commit per ticket, conventional commits.** Mirror IncaCook's discipline.

---

## 1. Cross-cutting infrastructure

These platform pieces every module assumes. Each gets its own submodule under
`src/infrastructure/` — pattern already established.

| Piece | Notes |
|---|---|
| **Supabase Storage** | Private buckets per resource (`avatars`, `listing-photos`, `seller-banners`, `chat-attachments`, `verifications`). Signed URLs only — never public. Helper service for upload / sign / delete. |
| **BullMQ + Redis** | Add `@nestjs/bullmq` and a `JobModule` with named queues: `image-processing`, `notifications`, `aggregates`, `webhooks`, `reconciliation`. The bootstrap doc deferred this; pull it in now. Worker process (`worker.ts`) added in M0. |
| **PostGIS** | Enable extension in Supabase. Add `location geography(Point, 4326)` columns on `User` (last known), `Listing`, `SellerProfile` (pickup point), `Deliverer` (current). Index with GIST. Distance via `ST_DWithin` and `ST_Distance`. |
| **Category radius caps** | Live in code (`CATEGORY_MAX_KM`), enforced at query time, not on the data. Source: PRODUCT.md §3. |
| **i18n** | Single French copy file (`src/common/i18n/fr.ts`) for server-emitted strings — order status labels, error messages, notification bodies. No runtime locale switch; the server speaks French. |
| **Audit log** | `AuditLog` table written by an interceptor on every admin endpoint. Cheap insurance for the manual-ops phase. |
| **Event bus** | `EventEmitterModule` already in `app.module.ts`. Use it for `order.created`, `payment.succeeded`, `review.posted`, etc. Side effects (notifications, aggregates) subscribe. |
| **Observability** | Pino is wired; add Sentry for errors, a `/v1/health/metrics` Prometheus endpoint, and a structured access log via the existing correlation-id middleware. |
| **Idempotency** | `Idempotency-Key` header support on POST endpoints (orders, payments). Redis-backed dedupe with 24h TTL. |
| **Money** | Always cents (integer) + ISO 4217 currency. Helper for CDF/USD formatting matching Flutter's display. |

---

## 2. Domain milestones

Estimates assume one engineer working continuously. Milestones can parallelize
where noted (see §3 sequencing).

---

### M0 — Close the auth gap (~1 week)

Finish what the bootstrap left as "future." Everything downstream depends on
this.

**Goals**
- Real Supabase users get a local `User` row automatically.
- Role gating works without per-controller wiring.
- The first real e2e tests cover auth.
- The worker process exists (even if no queues are populated yet).

**Tickets**
- `feat(auth): supabase webhook for user provisioning`
  - `POST /v1/internal/supabase/auth-hook` — receives `user.created` and
    `user.updated`, upserts local `User` by `supabaseId`. Verify webhook
    signature. `@Public()` but signature-gated.
- `feat(auth): JIT user provisioning fallback`
  - In `SupabaseJwtStrategy.validate`, if no local row exists, create one from
    JWT claims (email, phone). Defensive in case the webhook fails.
- `feat(users): GET /v1/users/me`
  - Canonical "who am I" endpoint, called on app launch. Returns role,
    profile fields, displayName.
- `feat(auth): phone OTP endpoints`
  - `POST /v1/auth/phone-otp/send` and `/v1/auth/phone-otp/verify` proxy to
    Supabase Auth. Phone-first onboarding is plausible in DRC.
- `feat(common): register RolesGuard globally`
  - Add as a second `APP_GUARD` in `app.module.ts` so `@Roles(...)` works
    without per-controller boilerplate.
- `feat(infra): worker process`
  - `src/worker.ts` standalone bootstrap that boots BullMQ workers. Same
    Docker image, different entrypoint.
- `test(auth): first e2e suite`
  - Auth happy path, sad path (invalid JWT, expired, wrong audience), JIT
    provisioning, role gating. Sets the e2e test pattern for everything below.

**Acceptance**
- `pnpm test:e2e` runs and passes against a freshly-seeded test database.
- A user signing up via Supabase Studio shows up in the local `users` table
  within seconds.
- `@Roles('ADMIN')` on a controller method 403s for non-admins automatically.

---

### M1 — Identity & profile (~1 week)

Backs the Flutter Settings, saved-addresses, and recently-viewed surfaces.

**Schema additions**
```prisma
model User {
  // ...existing fields
  avatarUrl         String?
  defaultLocation   Unsupported("geography(Point, 4326)")?
  preferredLanguage String   @default("fr")
  themePref         String   @default("system")   // 'system' | 'light' | 'dark'
}

model Address {
  id                   String   @id @default(cuid())
  userId               String
  label                String   // 'home' | 'work' | 'other' | custom
  formatted            String
  location             Unsupported("geography(Point, 4326)")
  gateCode             String?
  floor                String?
  deliveryInstructions String?
  isDefault            Boolean  @default(false)
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt
  user                 User     @relation(fields: [userId], references: [id])

  @@index([userId])
  @@map("addresses")
}

model Device {
  id          String   @id @default(cuid())
  userId      String
  platform    String   // 'ios' | 'android' | 'web'
  pushToken   String   @unique
  lastSeenAt  DateTime @default(now())
  createdAt   DateTime @default(now())
  user        User     @relation(fields: [userId], references: [id])

  @@index([userId])
  @@map("devices")
}
```

**Endpoints**
- `GET    /v1/users/me`                (returns profile + default address)
- `PATCH  /v1/users/me`                (displayName, themePref, language)
- `POST   /v1/users/me/avatar`         (signed-URL upload pattern)
- `GET    /v1/users/me/addresses`
- `POST   /v1/users/me/addresses`
- `PATCH  /v1/users/me/addresses/:id`
- `DELETE /v1/users/me/addresses/:id`
- `POST   /v1/users/me/addresses/:id/default`
- `GET    /v1/users/me/recently-viewed`
- `POST   /v1/users/me/devices`        (push token registration)
- `DELETE /v1/users/me/devices/:id`

**Notes**
- Recently-viewed: Redis sorted set keyed by user (`rv:{userId}`), capped at 50,
  TTL 30 days. Writes happen on listing-detail GETs (M2).
- Avatar bucket: `avatars/` in Supabase Storage, private.
- Only one address per user can be `isDefault = true` — enforce in a transaction.

---

### M2 — Catalog: sellers + listings (~2 weeks)

The biggest single chunk. Mirrors the seller-profile and listing-detail screens.

#### Sellers

Every credibility primitive PRODUCT.md §2 calls out has a home in the schema.

```prisma
model SellerProfile {
  id                String   @id @default(cuid())
  userId            String   @unique
  bio               String?
  heroUrl           String?
  bannerUrl         String?
  deliveryRadiusKm  Int      @default(15)
  availability      Json     // { mon: '9-18', tue: '9-18', ... } or null per day
  languages         String[] // ISO 639-1 codes
  pickupPoint       Unsupported("geography(Point, 4326)")?
  promoText         String?
  promoActive       Boolean  @default(false)
  promoExpiresAt    DateTime?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  user              User           @relation(fields: [userId], references: [id])
  verifications     Verification[]
  stats             SellerStats?

  @@map("seller_profiles")
}

model Verification {
  id            String              @id @default(cuid())
  sellerId      String
  kind          VerificationKind
  status        VerificationStatus  @default(PENDING)
  evidenceUrl   String?
  verifiedAt    DateTime?
  verifiedBy    String?             // admin userId
  notes         String?
  seller        SellerProfile       @relation(fields: [sellerId], references: [id])

  @@unique([sellerId, kind])
  @@map("verifications")
}

enum VerificationKind {
  IDENTITY
  HYGIENE_CHARTER
  PHONE
  ADDRESS
}

enum VerificationStatus { PENDING APPROVED REJECTED }

// Materialized via the `aggregates` queue. Fast reads, eventually consistent.
model SellerStats {
  sellerId           String  @id
  avgRating          Float   @default(0)
  ratingCount        Int     @default(0)
  distribution       Json    // { '5': 12, '4': 8, ... }
  hygieneBar         Float   @default(0)   // 0..1
  qualityBar         Float   @default(0)
  packagingBar       Float   @default(0)
  topSentimentTags   String[]
  updatedAt          DateTime @updatedAt
  seller             SellerProfile @relation(fields: [sellerId], references: [id])

  @@map("seller_stats")
}
```

**Endpoints**
- `GET   /v1/sellers/:id`              (profile + stats + verifications + active promo)
- `GET   /v1/sellers/:id/listings`
- `GET   /v1/sellers/:id/reviews`
- `PUT   /v1/sellers/me/profile`
- `POST  /v1/sellers/me/banner`        (signed-URL upload)
- `POST  /v1/sellers/me/hero`

#### Listings

```prisma
enum ListingCategory {
  COSMETIQUE
  TEXTILE
  SECONDE_MAIN
  AGRICOLE
  SERVICES
  AUTRES
}

enum ListingStatus { DRAFT PUBLISHED SOLD_OUT ARCHIVED }

model Listing {
  id                String           @id @default(cuid())
  sellerId          String
  title             String
  description       String
  category          ListingCategory
  priceCents        Int
  currency          String           @default("CDF")
  location          Unsupported("geography(Point, 4326)")
  photos            Json             // [{ url, sm, md, lg, alt? }]
  options           Json?            // free-form variants/sizes
  quantityAvailable Int              @default(1)
  status            ListingStatus    @default(DRAFT)
  expiresAt         DateTime?
  createdAt         DateTime         @default(now())
  updatedAt         DateTime         @updatedAt
  publishedAt       DateTime?
  deletedAt         DateTime?
  seller            SellerProfile    @relation(fields: [sellerId], references: [id])

  @@index([category, status])
  @@index([sellerId])
  @@map("listings")
}
```

**Endpoints**
- `GET    /v1/listings/:id`
- `POST   /v1/listings`                  (DRAFT)
- `PATCH  /v1/listings/:id`
- `POST   /v1/listings/:id/publish`
- `POST   /v1/listings/:id/archive`
- `POST   /v1/listings/:id/photos`       (multipart → presigned URL flow)
- `DELETE /v1/listings/:id/photos/:photoId`
- `DELETE /v1/listings/:id`              (soft delete)

**Photo pipeline**
1. Client uploads original via signed URL to `listing-photos/{listingId}/`.
2. Client POSTs metadata to API; API enqueues `image-processing` job.
3. Worker generates `sm/md/lg` variants (e.g. 400/800/1600px) via `sharp`,
   stores variant URLs back on the listing row.
4. Failed jobs go to a dead-letter queue with admin visibility.

**Geo enforcement**
- Category caps live in `src/modules/listings/category-caps.ts`:
  `{ COSMETIQUE: 25, TEXTILE: 25, SECONDE_MAIN: 15, AGRICOLE: 30, SERVICES: 20, AUTRES: 25 }`.
- All search and feed queries apply the cap per listing's category, not
  globally.

---

### M3 — Discovery: search + home rails (~1 week)

Replaces the six home rails (PRODUCT.md §4) and the filter sheet.

**Search**
- Postgres full-text on `tsvector(title || ' ' || description)` with a French
  config (`french` text search config) + `pg_trgm` for fuzzy fallback.
- Query params: `q`, `category`, `maxDistanceKm` (capped by category), `sort`
  (`relevance` | `priceAsc` | `priceDesc` | `distance` | `newest`),
  cursor pagination.
- Endpoint: `GET /v1/search`.

**Home feed** — one endpoint returns all six rails so the Flutter screen
hits a single API.

`GET /v1/feed?lat=...&lng=...`

| Rail | Source |
|---|---|
| `aDecouvrir` | Recent + popularity-weighted listings within max category radius |
| `bonsPlans` | Listings with `discountPct` ≥ 15% OR price in bottom quartile of category |
| `bientotTermine` | `quantityAvailable ≤ 2` OR `expiresAt < now + 48h` |
| `servicesPresDeToi` | `category = SERVICES`, sorted by distance |
| `vendeursProches` | Distinct sellers with PUBLISHED listings within radius, sorted by distance |
| `vuRecemment` | From Redis sorted set written in M1 |

**Caching**
- Cache each rail per user in Redis with location quantized to a 5km grid
  (`feed:{rail}:{geohash5}`), TTL 60s for pilot. Aggressive on purpose —
  pilot has low traffic, freshness matters more than hit rate.

---

### M4 — Cart + orders (~1.5 weeks)

The transactional core. Mirrors checkout + order-tracking screens.

#### Cart

```prisma
model Cart {
  id           String     @id @default(cuid())
  userId       String     @unique
  sellerId     String?
  promoCodeId  String?
  updatedAt    DateTime   @updatedAt
  items        CartItem[]
  user         User       @relation(fields: [userId], references: [id])

  @@map("carts")
}

model CartItem {
  id         String   @id @default(cuid())
  cartId     String
  listingId  String
  quantity   Int      @default(1)
  options    Json?
  cart       Cart     @relation(fields: [cartId], references: [id])

  @@index([cartId])
  @@map("cart_items")
}
```

**Single-seller invariant**
- `POST /v1/cart/items` rejects with a structured `CART_SELLER_CONFLICT`
  error envelope when the new item's `sellerId` ≠ the cart's `sellerId`.
- The Flutter UI already has the "switch confirmation" dialog; it calls
  `POST /v1/cart/replace` to swap.

**Endpoints**
- `GET    /v1/cart`
- `POST   /v1/cart/items`
- `PATCH  /v1/cart/items/:id`        (quantity)
- `DELETE /v1/cart/items/:id`
- `POST   /v1/cart/replace`          (clear + add atomically)
- `POST   /v1/cart/promo`            (apply code)
- `DELETE /v1/cart/promo`

#### Orders

```prisma
enum OrderStatus {
  PREPARING     // "Préparée"
  ON_THE_WAY    // "En route"
  DELIVERED     // "Livrée"
  CANCELLED
  REFUNDED
}

enum FulfillmentType { DELIVERY PICKUP }

model Order {
  id                String          @id @default(cuid())
  buyerId           String
  sellerId          String
  status            OrderStatus     @default(PREPARING)
  fulfillmentType   FulfillmentType
  addressSnapshot   Json?           // null for PICKUP
  subtotalCents     Int
  discountCents     Int             @default(0)
  deliveryFeeCents  Int             @default(0)
  totalCents        Int
  currency          String          @default("CDF")
  promoCodeSnapshot Json?
  etaAt             DateTime?
  delivererId       String?
  paymentId         String?
  createdAt         DateTime        @default(now())
  updatedAt         DateTime        @updatedAt
  items             OrderItem[]

  @@index([buyerId])
  @@index([sellerId])
  @@index([status])
  @@map("orders")
}

model OrderItem {
  id           String  @id @default(cuid())
  orderId      String
  listingId    String
  titleSnapshot       String
  priceCentsSnapshot  Int
  photoUrlSnapshot    String?
  quantity     Int
  options      Json?
  order        Order   @relation(fields: [orderId], references: [id])

  @@index([orderId])
  @@map("order_items")
}
```

**Status machine** (enforced server-side, allowed transitions only):
```
PREPARING  → ON_THE_WAY, CANCELLED
ON_THE_WAY → DELIVERED, CANCELLED
DELIVERED  → REFUNDED
```

Every transition emits a domain event:
- `order.created`            → notification to seller
- `order.status.preparing`   → (initial, no notification)
- `order.status.on_the_way`  → push + chat system message to buyer
- `order.status.delivered`   → push + chat system message + review prompt
- `order.status.cancelled`   → push to both sides
- `order.status.refunded`    → push + wallet credit

**Endpoints**
- `POST /v1/orders`                    (from current cart; atomic with inventory decrement)
- `GET  /v1/orders`                    (paginated, filterable by status)
- `GET  /v1/orders/:id`
- `POST /v1/orders/:id/cancel`         (buyer or seller, status-aware)
- `POST /v1/orders/:id/status`         (seller-only; status machine enforced)

**Inventory**
- `SELECT ... FOR UPDATE` on each `Listing.quantityAvailable` inside the order
  transaction. Decrement; if any item underflows, abort with `OUT_OF_STOCK`.

---

### M5 — Payments (all three rails) (~2 weeks, partial parallel with M4)

Provider abstraction first, then three implementations.

**Interface**
```ts
interface PaymentProvider {
  readonly kind: 'STRIPE' | 'PAYPAL' | 'MOBILE_MONEY';
  createIntent(order: Order, ctx: PaymentContext): Promise<PaymentIntent>;
  confirm(payload: unknown): Promise<PaymentResult>;
  refund(payment: Payment, amountCents?: number): Promise<RefundResult>;
  verifyWebhook(req: Request): Promise<WebhookEvent>;
}
```

**Stripe**
- PaymentIntents API.
- Webhook at `/v1/internal/stripe/webhook` with signature verification and
  idempotency on event IDs.
- Primary use case: diaspora buyers with non-DRC cards. Stripe does not
  acquire in DRC.

**PayPal**
- REST `Orders v2` API, redirect flow.
- Webhook for capture confirmation.

**Mobile Money — Pawapay aggregator**
- Recommend Pawapay over direct integrations. Covers Vodacom M-Pesa, Orange
  Money, Airtel Money in DRC with a single API. Direct integrations are
  multi-week vendor sales cycles each.
- USSD-push flow: buyer enters phone, gets USSD prompt, confirms with PIN.
- Webhook for transaction confirmation.
- **Fallback**: if Pawapay onboarding is blocked at pilot launch, support a
  **manual reconciliation** path — buyer pays via USSD outside the app,
  enters transaction ID, admin matches and marks `PaymentAttempt.status=SUCCEEDED`.

**Schema**
```prisma
enum PaymentStatus { PENDING SUCCEEDED FAILED CANCELLED REFUNDED }

model Payment {
  id              String        @id @default(cuid())
  orderId         String        @unique
  provider        String        // 'STRIPE' | 'PAYPAL' | 'MOBILE_MONEY' | 'MANUAL'
  providerRef     String?       // provider-side ID
  amountCents     Int
  currency        String
  status          PaymentStatus @default(PENDING)
  capturedAt      DateTime?
  failureReason   String?
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
  attempts        PaymentAttempt[]

  @@map("payments")
}

model PaymentAttempt {
  id              String   @id @default(cuid())
  paymentId       String
  idempotencyKey  String?
  provider        String
  request         Json     // sanitized
  response        Json     // sanitized
  status          PaymentStatus
  createdAt       DateTime @default(now())
  payment         Payment  @relation(fields: [paymentId], references: [id])

  @@index([paymentId])
  @@map("payment_attempts")
}
```

**Endpoints**
- `POST /v1/orders/:id/payment`                  (create intent; returns provider-specific payload)
- `POST /v1/payments/:id/confirm`                (client-confirmed, e.g. PayPal capture token)
- `GET  /v1/payments/:id`
- `POST /v1/internal/stripe/webhook`             (@Public + signature)
- `POST /v1/internal/paypal/webhook`             (@Public + signature)
- `POST /v1/internal/pawapay/webhook`            (@Public + signature)
- `POST /v1/admin/payments/:id/refund`           (ADMIN)
- `POST /v1/admin/payments/manual-confirm`       (ADMIN; for fallback path)

**Reconciliation**
- Nightly job (`reconciliation` queue) pulls provider statements and flags
  mismatches in the admin app.

---

### M6 — Delivery scaffolding (~1 week)

The Livreur role exists in the data model and order-tracking screens but the
UI is sparse. Backend supports manual ops + a future fleet app.

**Schema**
```prisma
model Deliverer {
  id              String   @id @default(cuid())
  userId          String   @unique
  vehicleType     String   // 'moto' | 'voiture' | 'velo' | 'a_pied'
  phoneMasked     String   // last 3 digits visible
  currentLocation Unsupported("geography(Point, 4326)")?
  available       Boolean  @default(false)
  updatedAt       DateTime @updatedAt
  user            User     @relation(fields: [userId], references: [id])

  @@map("deliverers")
}
```

(The `User.role` enum gains `DELIVERY_PARTNER`.)

**Endpoints**
- `POST  /v1/admin/orders/:id/assign-deliverer`     (ADMIN)
- `PATCH /v1/deliveries/:id/status`                  (DELIVERY_PARTNER; future app)
- `PATCH /v1/deliveries/me/location`                 (DELIVERY_PARTNER; future)
- `PATCH /v1/deliveries/me/available`                (DELIVERY_PARTNER; future)

**ETA**
- Straight-line distance × constant (e.g. 15 min/km, accounting for Kinshasa
  traffic). Crude but matches what the UI displays.
- Computed at assignment and stored on `Order.etaAt`.

---

### M7 — Messaging / chat (~1.5 weeks)

Backs the Chat screen, which currently has no transport.

**Schema**
```prisma
model ChatThread {
  id            String        @id @default(cuid())
  participantA  String        // userId (lexicographically smaller)
  participantB  String        // userId
  listingId     String?
  orderId       String?
  lastMessageAt DateTime?
  createdAt     DateTime      @default(now())
  messages      ChatMessage[]

  @@unique([participantA, participantB, listingId, orderId])
  @@index([participantA])
  @@index([participantB])
  @@map("chat_threads")
}

model ChatMessage {
  id              String     @id @default(cuid())
  threadId        String
  senderId        String?    // null for system messages
  body            String?
  attachments     Json?      // [{ url, kind }]
  systemEventKind String?    // 'ORDER_PREPARING' | 'ORDER_ON_THE_WAY' | ...
  readBy          String[]
  createdAt       DateTime   @default(now())
  thread          ChatThread @relation(fields: [threadId], references: [id])

  @@index([threadId, createdAt])
  @@map("chat_messages")
}
```

**Transport**
- **Supabase Realtime** for delivery. It's already in our stack and avoids
  running a Socket.io fleet. Server writes to Postgres; clients subscribe to
  the `chat_messages` table filtered by their threads (RLS enforces visibility).
- Typing indicators via Supabase broadcast channels (ephemeral, no DB writes).

**System messages**
- Auto-posted on order events into the buyer↔seller thread:
  - `order.status.preparing`  → "Votre commande est en préparation."
  - `order.status.on_the_way` → "Votre commande est en route."
  - `order.status.delivered`  → "Votre commande a été livrée."

**Unread counts**
- Redis hash `unread:{userId}` → `{ threadId: count }`, incremented on insert,
  cleared on read.

**Endpoints**
- `GET   /v1/chat/threads`
- `GET   /v1/chat/threads/:id`
- `POST  /v1/chat/threads`                       (start a thread, optionally about a listing)
- `GET   /v1/chat/threads/:id/messages`
- `POST  /v1/chat/threads/:id/messages`
- `POST  /v1/chat/threads/:id/read`              (mark all as read)
- `POST  /v1/chat/messages/:id/attachments`      (signed-URL upload)

---

### M8 — Reviews & trust (~1 week)

**Schema**
```prisma
enum ReviewStatus { PENDING APPROVED REJECTED }

model Review {
  id            String       @id @default(cuid())
  orderId       String       @unique
  authorId      String
  sellerId      String
  rating        Int          // 1..5
  body          String?
  sentimentTags String[]
  status        ReviewStatus @default(APPROVED)  // auto-approve in pilot
  createdAt     DateTime     @default(now())
  updatedAt     DateTime     @updatedAt

  @@index([sellerId])
  @@index([status])
  @@map("reviews")
}
```

**Eligibility**
- `Review.orderId` is the gating FK: only the buyer of a `DELIVERED` order
  can post a review for that order's seller. One review per order.

**Sentiment vocabulary**
- Closed vocab seeded from PRODUCT.md examples (`hydratant`, `naturel`,
  `à l'heure`, `bien emballé`, …). Stored in a `SentimentTag` table for
  admin-extension. Listing detail and seller profile show the top-N for
  that seller.

**Aggregates**
- On insert/update, enqueue an `aggregates` job (debounced 5s per seller)
  that recomputes `SellerStats`: avg rating, distribution, hygiene/quality/
  packaging bars (derived from a per-review structured part of the body or
  from tag presence — exact derivation TBD with product), top sentiment tags.

**Moderation**
- `status` starts `APPROVED` for pilot; admin can flip to `REJECTED` later.
  Rejected reviews are excluded from aggregates and public reads.

**Endpoints**
- `GET  /v1/sellers/:id/reviews`
- `POST /v1/orders/:id/review`                   (one per order)
- `PATCH /v1/reviews/:id`                        (author-only, within 7 days)
- `POST /v1/admin/reviews/:id/status`            (ADMIN)

---

### M9 — Notifications (~1 week)

**Channels**
- **Push**: FCM for Android, APNs for iOS. Token lifecycle managed via M1's
  `Device` table.
- **In-app feed**: `Notification` table + `GET /v1/notifications`.
- **Email**: transactional via Resend for order confirmations and receipts.
  Templates in French.

**Schema**
```prisma
model Notification {
  id          String   @id @default(cuid())
  userId      String
  kind        String   // 'ORDER_STATUS' | 'CHAT_MESSAGE' | 'PROMO' | ...
  title       String
  body        String
  data        Json?    // deep-link payload
  readAt      DateTime?
  createdAt   DateTime @default(now())
  user        User     @relation(fields: [userId], references: [id])

  @@index([userId, createdAt])
  @@map("notifications")
}
```

**Pipeline**
- Domain events emit; the `notifications` worker subscribes, materializes
  the in-app row, fans out push + email per user preference, respects quiet
  hours (default 22:00–07:00 Kinshasa).

**Endpoints**
- `GET   /v1/notifications`
- `POST  /v1/notifications/:id/read`
- `POST  /v1/notifications/read-all`
- `PATCH /v1/users/me/notification-prefs`

---

### M10 — Promos & wallet (~1 week)

**Promo codes**
```prisma
enum PromoKind { PERCENT FIXED }

model PromoCode {
  id                    String    @id @default(cuid())
  code                  String    @unique
  kind                  PromoKind
  value                 Int       // % or cents
  maxUses               Int?
  perUserLimit          Int?      @default(1)
  validFrom             DateTime
  validUntil            DateTime
  applicableCategories  String[]
  applicableSellerIds   String[]
  usesCount             Int       @default(0)
  active                Boolean   @default(true)
  createdAt             DateTime  @default(now())

  @@map("promo_codes")
}

model PromoRedemption {
  id           String   @id @default(cuid())
  promoCodeId  String
  userId       String
  orderId      String
  createdAt    DateTime @default(now())

  @@unique([promoCodeId, orderId])
  @@index([userId])
  @@map("promo_redemptions")
}
```

- Apply at cart time (validates eligibility), lock at order time (writes
  redemption row inside the order transaction, increments `usesCount`).
- Snapshot on `Order.promoCodeSnapshot` so edits to the code don't rewrite
  history.

**Wallet**
```prisma
model Wallet {
  id          String         @id @default(cuid())
  userId      String         @unique
  balanceCents Int           @default(0)
  currency    String         @default("CDF")
  updatedAt   DateTime       @updatedAt
  entries     LedgerEntry[]

  @@map("wallets")
}

enum LedgerKind { TOPUP PURCHASE REFUND WITHDRAWAL ADJUSTMENT }

model LedgerEntry {
  id          String     @id @default(cuid())
  walletId    String
  amountCents Int        // signed
  kind        LedgerKind
  refOrderId  String?
  refPaymentId String?
  note        String?
  createdAt   DateTime   @default(now())
  wallet      Wallet     @relation(fields: [walletId], references: [id])

  @@index([walletId, createdAt])
  @@map("ledger_entries")
}
```

- Top-up via payment rails (M5) → ledger entry + balance increment in a tx.
- Seller withdrawal: admin-only endpoint for pilot. Records ledger entry +
  manual payout outside the system.

**Endpoints**
- `GET  /v1/wallet`
- `GET  /v1/wallet/entries`
- `POST /v1/wallet/topup`                        (creates a payment intent)
- `POST /v1/admin/promos`                         (ADMIN CRUD)
- `POST /v1/admin/wallets/:id/adjust`             (ADMIN)
- `POST /v1/admin/wallets/:id/withdraw`           (ADMIN)

---

### M11 — Admin API (parallel — pieces ship with each module above)

The `bomboli-admin` app needs an API surface for the manual-ops model. Add
endpoints under `/v1/admin/...` (RolesGuard with `ADMIN`). Every action writes
to `AuditLog` via the interceptor.

| Area | Endpoints |
|---|---|
| Sellers | List, view, toggle verification, suspend, edit profile |
| Listings | Search/filter, force status change, edit/remove photos |
| Orders | List with filters, force status, refund, reassign deliverer |
| Users | List, suspend, change role, view audit |
| Payments | List, reconcile, refund, manual-confirm |
| Reviews | Moderation queue, approve/reject |
| Deliverers | Onboard, list, assign to order, set availability |
| Promos | CRUD, usage stats |
| Audit | Read-only browse |

---

### M12 — Production-readiness (~1 week)

- **Test coverage**: aim for 60% e2e coverage of critical paths (signup → browse
  → buy → review).
- **Migrations**: Prisma `migrate deploy` in CI; documented ownership split
  — Prisma owns app tables, Supabase owns auth/realtime/storage.
- **Backup + restore drill** on Supabase, documented runbook.
- **Secret management**: move from `.env.test` patterns to production secrets
  via the chosen host's vault (Railway / Doppler / Fly).
- **Deployment host**: pick one (Railway recommended — MCP tooling already
  wired here, fast for a pilot). CI/CD via GitHub Actions: typecheck → lint
  → test → build → deploy on tag.
- **TLS + custom domain.**
- **Sentry** connected, alerting on error rate + p95 latency.
- **Rate-limit tuning** per endpoint (search/feed get higher limits than
  POST endpoints).
- **Runbook** for common ops: stuck order, failed payment reconciliation,
  bumped seller verification, deliverer offline.

---

## 3. Suggested sequencing

Single-engineer track, ~14 weeks to full v1. With a second engineer joining at
M2, payments (M5) and messaging (M7) parallelize to ~10 weeks.

```
Week  1  2  3  4  5  6  7  8  9  10 11 12 13 14
M0    [==]
M1       [==]
M2          [========]
M3                   [==]
M4                      [======]
M5                      [==========]      ← second engineer parallel
M6                            [==]
M7                               [======]
M8                                  [==]
M9                                     [==]
M10                                       [==]
M11   .........spread across all milestones........
M12                                          [==]
```

---

## 4. Cross-cutting risks / open decisions

| Topic | Decision needed | Default recommendation |
|---|---|---|
| Mobile Money aggregator | Flutterwave / Pawapay / MFS Africa | **Pawapay** — strong DRC coverage (Vodacom M-Pesa, Orange, Airtel) |
| Stripe at launch | Diaspora-card use case launch-critical? | Defer if not — Mobile Money is the must-have for DRC buyers |
| KYC for sellers | Manual vs provider | Manual review of uploaded ID photos for pilot; Smile ID post-pilot |
| Realtime transport | Supabase Realtime vs Socket.io | **Supabase Realtime** — in-stack, no extra ops |
| Hosting | Railway / Fly.io / Render | **Railway** — MCP available, fast pilot setup |
| Image CDN | Direct Supabase Storage vs CDN in front | Storage direct for pilot; reassess if perf hurts |
| Reverse geocoding | Mapbox vs OSM Nominatim | **Nominatim** for pilot (free, rate-limited); Mapbox if needed |
| Push certs | FCM project + APNs key needed before M9 | Action item on mobile lead |
| French copy review | Owner for server-emitted strings | Action item before M9 (notifications) |
| Per-order delivery fee | Flat? distance-based? per seller? | Distance-based with seller-configurable base fee — confirm with product |

---

## 5. Acceptance criteria for v1 launch

**A buyer in Kinshasa can:**
1. Sign up via Supabase Auth (email or phone OTP), land in the app, see their profile.
2. Set a saved address.
3. Browse the home feed with the six rails populated from real data.
4. Filter by category and distance.
5. Open a seller profile and see rating, bars, verifications, reviews.
6. Add a listing to cart, hit the single-seller invariant cleanly when switching.
7. Check out with delivery or pickup.
8. Pay via PayPal or Mobile Money (Stripe optional).
9. Watch the three-stage tracker update in real time.
10. Message the seller; receive a push when the seller replies.
11. Leave a review after delivery.

**A seller can:**
1. Onboard (manually verified by admin in pilot).
2. Manage profile, upload listings with photos.
3. Receive orders, mark statuses.
4. Reply to chat messages.
5. See ratings + sentiment tags accumulate.

**An admin can:**
1. Verify sellers (toggle the four verification flags).
2. Moderate listings + reviews.
3. Intervene on stuck orders.
4. Reconcile payments.
5. Assign deliverers.

---

## 6. Out of scope for v1

Tracked here so they don't sneak in:

- Multi-city expansion beyond Kinshasa.
- Automated KYC / liveness checks.
- Real-time deliverer mobile app (M6 is scaffolding only).
- Loyalty / referral programs.
- Multi-currency checkout (CDF/USD display only).
- Search personalization beyond recency + proximity.
- AI-anything (no recommendations, no moderation ML).
- Public API / third-party integrations.
