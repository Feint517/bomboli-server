# Bomboli API — Reference

> Contract for the Bomboli backend that ships **today**. Every endpoint
> documented here is implemented, tested, and ready for the Flutter app to
> integrate against.
>
> See [`v1-roadmap.md`](./v1-roadmap.md) for what's still coming. The shape
> of this document grows milestone by milestone — listings, search, orders,
> payments, etc. will be appended as they land.

## Table of contents

1. [Base URL & versioning](#base-url--versioning)
2. [Authentication model](#authentication-model)
3. [Response envelope](#response-envelope)
4. [Error model](#error-model)
5. [Common conventions](#common-conventions)
6. [Auth endpoints](#auth-endpoints)
   - [Signup](#post-v1authsignup)
   - [Login](#post-v1authlogin)
   - [Refresh](#post-v1authrefresh)
   - [Logout](#post-v1authlogout)
   - [Email verification](#post-v1authemailverify)
   - [Resend verification](#post-v1authemailresend-verification)
   - [Password reset — request](#post-v1authpasswordreset-request)
   - [Password reset — confirm](#post-v1authpasswordreset)
   - [OAuth exchange](#post-v1authoauthexchange)
   - [Phone OTP — send](#post-v1authphone-otpsend)
   - [Phone OTP — verify](#post-v1authphone-otpverify)
7. [User profile](#user-profile)
   - [Get my profile](#get-v1usersme)
   - [Update my profile](#patch-v1usersme)
   - [Init avatar upload](#post-v1usersmeavatar)
8. [Addresses](#addresses)
9. [Devices (push tokens)](#devices-push-tokens)
10. [Recently viewed](#recently-viewed)
11. [Sellers](#sellers)
12. [Listings](#listings)
13. [Listing photos](#listing-photos)
14. [Search](#search)
15. [Home feed](#home-feed)
16. [Cart](#cart)
17. [Orders](#orders)
18. [Payments](#payments)
19. [Deliveries](#deliveries)
20. [Health & ops](#health--ops)

---

## Base URL & versioning

| Environment | URL |
|---|---|
| Local dev | `http://localhost:3002` |
| Staging / Production | TBD (host decision in M12) |

All endpoints are prefixed with `/v1`. The path-versioned scheme is permanent
— breaking changes ship under a new prefix (`/v2`) so clients can migrate
gradually.

---

## Authentication model

**The Flutter app never talks to Supabase directly.** It only talks to the
Bomboli API. The server hides Supabase Auth behind the `/v1/auth/...`
endpoints and validates the Supabase-issued JWT on every protected route.

```
┌──────────┐    /v1/auth/*     ┌──────────┐    Supabase     ┌──────────────┐
│ Flutter  │ ────────────────▶ │ Bomboli  │ ──────────────▶ │ Supabase     │
│   app    │   (HTTPS)         │   API    │  (server-side)  │     Auth     │
└──────────┘                   └──────────┘                 └──────────────┘
       ▲                            │
       │   { session, user }        │
       └────────────────────────────┘
```

After signup / login / refresh / OAuth, the client receives a **session**:

```jsonc
{
  "accessToken": "eyJhbGc...",     // attach to subsequent calls
  "refreshToken": "vL1qzK...",     // store securely, used to refresh
  "expiresIn": 3600,               // seconds until the access token expires
  "expiresAt": 1779384800,         // unix seconds — absolute expiry
  "tokenType": "bearer"
}
```

Authenticated requests must carry:

```
Authorization: Bearer <accessToken>
```

When the access token expires (or 401s with `BOMBOLI_EXPIRED_TOKEN`), call
[`POST /v1/auth/refresh`](#post-v1authrefresh) with the refresh token to get
a fresh session.

### Authorization rules

- Most routes require a valid `Authorization: Bearer ...` header.
- Without one, the API returns `401` + `BOMBOLI_UNAUTHORIZED`.
- Some routes (admin-only) additionally check the user's role — `403` +
  `BOMBOLI_FORBIDDEN` when missing.
- Public routes (signup, login, refresh, password reset, OAuth exchange, OTP,
  health) need no auth.

---

## Response envelope

**Every** successful response from the API has this shape:

```jsonc
{
  "success": true,
  "data": { /* endpoint-specific payload */ },
  "meta": {
    "timestamp": "2026-05-20T17:45:12.000Z",
    "version": "v1"
  },
  "pagination": {              // only on paginated endpoints
    "nextCursor": "...",
    "hasMore": true,
    "total": 42
  }
}
```

The Flutter client should read `body.data` for the payload. Treat `meta` as
informational; `pagination` is absent on non-list endpoints.

---

## Error model

Errors share a uniform shape:

```jsonc
{
  "success": false,
  "error": {
    "statusCode": 401,
    "message": "Email ou mot de passe incorrect.",
    "error": "Unauthorized",
    "code": "BOMBOLI_INVALID_CREDENTIALS",
    "timestamp": "2026-05-20T17:45:12.000Z",
    "path": "/v1/auth/login",
    "correlationId": "01KS39YT...",
    "details": null
  }
}
```

- **`message`** is a user-facing **French** string safe to display directly in
  the UI.
- **`code`** is the stable, programmatically-consumable identifier — switch
  on this in your app, not on `message`.
- **`correlationId`** ties the error to server logs. Include it in bug
  reports.

### Error codes

| Code | Typical status | Meaning |
|---|---:|---|
| `BOMBOLI_UNKNOWN` | 500 | Unhandled server error |
| `BOMBOLI_VALIDATION_FAILED` | 400 | Request body / params invalid |
| `BOMBOLI_UNAUTHORIZED` | 401 | Missing or unparseable token |
| `BOMBOLI_INVALID_TOKEN` | 401 | Token signature / shape invalid |
| `BOMBOLI_EXPIRED_TOKEN` | 401 | Token expired — call refresh |
| `BOMBOLI_INVALID_CREDENTIALS` | 401 | Bad email/password on login |
| `BOMBOLI_EMAIL_NOT_VERIFIED` | 401 | Login blocked until verification |
| `BOMBOLI_INVALID_OTP` | 401 | OTP wrong or expired |
| `BOMBOLI_FORBIDDEN` | 403 | Authenticated but not allowed |
| `BOMBOLI_NOT_FOUND` | 404 | Resource doesn't exist (or isn't yours) |
| `BOMBOLI_CONFLICT` | 409 | Conflicting state (e.g. duplicate) |
| `BOMBOLI_EMAIL_TAKEN` | 409 | Signup with an in-use email |
| `BOMBOLI_RATE_LIMITED` | 429 | Per-user / per-IP throttle hit |
| `BOMBOLI_PASSWORD_TOO_WEAK` | 400 | Supabase rejected the password |
| `BOMBOLI_AUTH_PROVIDER_ERROR` | 502 | Upstream Supabase issue |

---

## Common conventions

| Topic | Rule |
|---|---|
| **Timestamps** | Always ISO-8601 UTC strings (`2026-05-20T17:45:12.000Z`) |
| **Geo coordinates** | Decimal degrees, WGS84. Latitudes `[-90, 90]`, longitudes `[-180, 180]`. Order is always `{ lat, lng }` in payloads. |
| **Phone numbers** | E.164 (`+243812345678`). DRC numbers start `+243`. |
| **Email** | Lowercased server-side. Send any case from the client. |
| **Currency** | Always **integer cents** + ISO 4217 code (`CDF`, `USD`). Never floats. |
| **Pagination** | Cursor-based — `nextCursor` opaque string. No pages on current endpoints; will appear in M2/M3 listings + search. |
| **Idempotency** | POSTs that mutate money/orders accept an `Idempotency-Key` header (UUID is fine). Reused keys replay the original response. Endpoints that need it will be flagged when they land in M4/M5. |
| **Language** | Server emits French. The `Accept-Language` header is ignored for now. |
| **CORS** | Configured per `ALLOWED_ORIGINS`. The Flutter app does not need to worry about CORS on mobile platforms. |

---

# Auth endpoints

All `/v1/auth/...` routes (except `/logout`) are **public** — no auth header
required. Responses for the session-returning endpoints (`signup` when no
email confirmation required, `login`, `refresh`, `verify`, `reset`, `oauth`)
share the same shape:

```jsonc
{
  "session": {
    "accessToken": "...",
    "refreshToken": "...",
    "expiresIn": 3600,
    "expiresAt": 1779384800,
    "tokenType": "bearer"
  },
  "user": { /* MeResponseDto — same shape as GET /v1/users/me */ }
}
```

---

### `POST /v1/auth/signup`

Create a new account. In environments where Supabase email confirmation is
**off** (local dev), a session is returned immediately. In production, the
client must call [email/verify](#post-v1authemailverify) before logging in.

**Request**
```jsonc
{
  "email": "jean@bomboli.test",        // required
  "password": "Bomboli-pwd-9",         // required: 8-72 chars, letter + digit
  "displayName": "Jean Kinshasa",      // optional, 1-120 chars
  "phone": "+243812345678"             // optional, E.164
}
```

**Success — `201 Created`**
```jsonc
{
  "user": { /* MeResponseDto */ },
  "session": { /* SessionDto */ } | null,
  "requiresEmailConfirmation": false
}
```

**Errors**
- `400` `BOMBOLI_VALIDATION_FAILED` — bad email, weak password, etc.
- `409` `BOMBOLI_EMAIL_TAKEN` — duplicate signup
- `400` `BOMBOLI_PASSWORD_TOO_WEAK` — Supabase-side policy rejection

---

### `POST /v1/auth/login`

**Request**
```jsonc
{ "email": "jean@bomboli.test", "password": "Bomboli-pwd-9" }
```

**Success — `200 OK`**
```jsonc
{ "session": {...}, "user": {...} }
```

**Errors**
- `401` `BOMBOLI_INVALID_CREDENTIALS` — wrong email or password
- `401` `BOMBOLI_EMAIL_NOT_VERIFIED` — needs `email/verify` first

---

### `POST /v1/auth/refresh`

Exchange a refresh token for a fresh session. Call when the access token
expires.

**Request**
```jsonc
{ "refreshToken": "vL1qzK..." }
```

**Success — `200 OK`** — `{ session, user }`.

**Errors**
- `400` validation — missing refresh token
- `502` `BOMBOLI_AUTH_PROVIDER_ERROR` — refresh token revoked/expired

---

### `POST /v1/auth/logout`

Server-side revocation of the user's refresh tokens. Client should also
discard the local copy.

**Auth required.**

**Request** — empty body.

**Success — `204 No Content`.**

**Errors**
- `401` if `Authorization` header is missing.

---

### `POST /v1/auth/email/verify`

Confirm a freshly-created account using the OTP delivered by email.

**Request**
```jsonc
{ "email": "jean@bomboli.test", "token": "123456" }
```

**Success — `200 OK`** — returns a `{ session, user }` on success (the user
is logged in immediately).

**Errors**
- `401` `BOMBOLI_INVALID_OTP` — wrong or expired code

---

### `POST /v1/auth/email/resend-verification`

**Request**
```jsonc
{ "email": "jean@bomboli.test" }
```

**Success — `202 Accepted`** — `{ "sent": true }`.

Returns 202 regardless of whether the email is known (anti-enumeration). The
`429 BOMBOLI_RATE_LIMITED` case is exposed so the UI can show a cooldown.

---

### `POST /v1/auth/password/reset-request`

**Request**
```jsonc
{ "email": "jean@bomboli.test" }
```

**Success — `202 Accepted`** — `{ "sent": true }`.

Always 202 regardless of whether the email is registered.

---

### `POST /v1/auth/password/reset`

Two-step server-side flow: verify the recovery OTP, then update the password.
Returns a session so the user is logged in on success.

**Request**
```jsonc
{
  "email": "jean@bomboli.test",
  "token": "123456",
  "newPassword": "New-Pass-9876"
}
```

**Success — `200 OK`** — `{ session, user }`.

**Errors**
- `401` `BOMBOLI_INVALID_OTP`
- `400` `BOMBOLI_PASSWORD_TOO_WEAK`

---

### `POST /v1/auth/oauth/exchange`

Exchange a native-SDK-issued OAuth `id_token` (from Google Sign In on Android
or Sign in with Apple on iOS) for a Supabase session.

**Request**
```jsonc
{
  "provider": "google",                  // 'google' | 'apple'
  "idToken": "eyJhbGc...",               // from the native SDK
  "nonce": "abc123",                     // required for Apple, optional Google
  "accessToken": "ya29..."               // optional, Apple authorization code
}
```

**Success — `200 OK`** — `{ session, user }`.

---

### `POST /v1/auth/phone-otp/send`

Trigger an SMS OTP delivery via Supabase. Requires an SMS provider
configured in Supabase (Twilio etc.). In local dev with no SMS provider,
this will fail with `BOMBOLI_AUTH_PROVIDER_ERROR`.

**Request**
```jsonc
{ "phone": "+243812345678" }
```

**Success — `202 Accepted`** — `{ "sent": true }`.

---

### `POST /v1/auth/phone-otp/verify`

**Request**
```jsonc
{ "phone": "+243812345678", "token": "123456" }
```

**Success — `200 OK`**
```jsonc
{ "accessToken": "...", "refreshToken": "...", "expiresIn": 3600 }
```

**Errors**
- `401` `BOMBOLI_INVALID_OTP`

> **Note**: this endpoint returns a session at the top level (not nested
> under `session`). The other session-issuing endpoints return
> `{ session, user }`. This will be normalized in a future revision; for now,
> branch on the endpoint when parsing.

---

# User profile

### `GET /v1/users/me`

The canonical "who am I" endpoint. Call after every signup/login and on
app launch.

**Auth required.**

**Success — `200 OK`**
```jsonc
{
  "id": "cmpe...",
  "supabaseId": "00000000-0000-0000-0000-000000000002",
  "email": "jean@bomboli.test",
  "phone": "+243812345678" | null,
  "role": "BUYER",                       // 'BUYER' | 'SELLER' | 'ADMIN'
  "displayName": "Jean Kinshasa" | null,
  "avatarUrl": "avatars/uuid/...jpg" | null,
  "preferredLanguage": "fr",             // 'fr' | 'en'
  "themePref": "system",                 // 'system' | 'light' | 'dark'
  "defaultLocation": { "lat": -4.3217, "lng": 15.3125 } | null,
  "emailVerifiedAt": "2026-05-20T..." | null,
  "phoneVerifiedAt": "2026-05-20T..." | null,
  "lastSignInAt": "2026-05-20T..." | null,
  "createdAt": "2026-05-20T...",
  "updatedAt": "2026-05-20T..."
}
```

---

### `PATCH /v1/users/me`

Update mutable profile fields. Send **only** the fields you want to change.
To clear a nullable field (displayName, defaultLocation), send `null`.

**Auth required.**

**Request — all fields optional**
```jsonc
{
  "displayName": "Jean Kinshasa" | null,
  "preferredLanguage": "fr",             // 'fr' | 'en'
  "themePref": "dark",                   // 'system' | 'light' | 'dark'
  "defaultLocation": { "lat": -4.3217, "lng": 15.3125 } | null
}
```

**Success — `200 OK`** — returns the full updated `MeResponseDto`.

**Errors**
- `400` `BOMBOLI_VALIDATION_FAILED` — unknown theme, out-of-range coords

---

### `POST /v1/users/me/avatar`

**Two-step upload protocol.** The API never receives the binary; clients
upload directly to Supabase Storage via a signed URL.

1. **Initialize**: POST here with the file's content-type → receive a signed
   PUT URL.
2. **Upload**: client PUTs the bytes directly to `signedUrl` with the matching
   `Content-Type` header.
3. **Commit**: `PATCH /v1/users/me` with `avatarUrl` set to `expectedAvatarUrl`
   from step 1.

**Auth required.**

**Request**
```jsonc
{ "contentType": "image/jpeg" }    // 'image/jpeg' | 'image/png' | 'image/webp'
```

**Success — `201 Created`**
```jsonc
{
  "bucket": "avatars",
  "path": "<supabaseId>/<ulid>.jpg",
  "token": "...",
  "signedUrl": "http://.../storage/v1/object/upload/sign/avatars/...?token=...",
  "expectedAvatarUrl": "avatars/<supabaseId>/<ulid>.jpg"
}
```

**Errors**
- `400` `BOMBOLI_VALIDATION_FAILED` — unsupported content-type

> **Display**: avatar URLs returned by `/users/me` are bucket-relative
> (`avatars/<path>`). When listings & profiles ship in M2, we'll add an
> endpoint to mint short-lived signed read URLs for display.

---

# Addresses

Each user can have multiple saved addresses. Exactly **one** is the default
at any time; this is enforced at the DB level. Setting one default
automatically demotes the others.

The very first address created becomes the default automatically.

---

### `GET /v1/users/me/addresses`

List all addresses for the current user, default first.

**Auth required.**

**Success — `200 OK`** — `[ AddressResponseDto ]`

```jsonc
[
  {
    "id": "01HXY...",
    "label": "home",                                // free-form, 1-40 chars
    "formatted": "12 Avenue Lumumba, Kinshasa",
    "lat": -4.3217,
    "lng": 15.3125,
    "gateCode": "#4521" | null,
    "floor": "3" | null,
    "deliveryInstructions": "Sonner deux fois" | null,
    "isDefault": true,
    "createdAt": "2026-05-20T...",
    "updatedAt": "2026-05-20T..."
  }
]
```

---

### `POST /v1/users/me/addresses`

**Auth required.**

**Request**
```jsonc
{
  "label": "home",
  "formatted": "12 Avenue Lumumba, Kinshasa",
  "lat": -4.3217,
  "lng": 15.3125,
  "gateCode": "#4521",          // optional
  "floor": "3",                  // optional
  "deliveryInstructions": "Sonner deux fois",  // optional
  "isDefault": true              // optional — omit on first create (auto-true)
}
```

**Success — `201 Created`** — full `AddressResponseDto`.

---

### `PATCH /v1/users/me/addresses/:id`

Partial update. `lat` and `lng` must be provided together (or both omitted).

**Auth required.** Owner-only — `403` if you try to touch someone else's
address.

**Request** — any subset of:
```jsonc
{
  "label": "...",
  "formatted": "...",
  "lat": -4.3, "lng": 15.3,
  "gateCode": "..." | null,
  "floor": "..." | null,
  "deliveryInstructions": "..." | null
}
```

**Success — `200 OK`** — updated `AddressResponseDto`.

---

### `DELETE /v1/users/me/addresses/:id`

**Auth required. Owner-only.**

**Success — `204 No Content`.**

---

### `POST /v1/users/me/addresses/:id/default`

Promote this address to default. Atomically demotes the previous default.

**Auth required. Owner-only.**

**Success — `200 OK`** — the now-default `AddressResponseDto`.

---

# Devices (push tokens)

Register the device's FCM/APNs token so the server can fan out push
notifications (wired in M9). Re-registering the same `pushToken` is idempotent
and bumps `lastSeenAt` — call on every app launch.

---

### `GET /v1/users/me/devices`

**Auth required.**

**Success — `200 OK`**
```jsonc
[
  {
    "id": "01HXY...",
    "platform": "android",     // 'ios' | 'android' | 'web'
    "lastSeenAt": "2026-05-20T...",
    "createdAt": "2026-05-20T..."
  }
]
```

---

### `POST /v1/users/me/devices`

**Auth required.**

**Request**
```jsonc
{
  "platform": "android",
  "pushToken": "..." // FCM or APNs token, ≤ 2048 chars
}
```

**Success — `201 Created`** — same shape as the list items. Idempotent on
`pushToken` (re-registration returns the same `id`).

---

### `DELETE /v1/users/me/devices/:id`

Unregister a device — call on logout or push-permission revocation.

**Auth required. Owner-only.**

**Success — `204 No Content.**

---

# Recently viewed

Tracks the last 50 listings each user opened, kept in Redis with a 30-day
TTL. Reads work today; **writes start in M2** when listings ship — so today
this endpoint will always return an empty `listingIds` array.

---

### `GET /v1/users/me/recently-viewed`

**Auth required.**

**Success — `200 OK`**
```jsonc
{ "listingIds": ["01HXY...", "01HXZ...", ...] }
```

Views are recorded automatically on `GET /v1/listings/:id` when the request
carries a Bearer token. The `listingIds` array is sorted most-recent-first.

---

# Sellers

A user becomes a seller by **creating a seller profile**. The first call to
`PUT /v1/sellers/me/profile` does both — creates the profile and flips
`User.role` from `BUYER` to `SELLER`. Subsequent calls are pure updates.
`ADMIN` users keep their role.

The profile bundles every credibility primitive PRODUCT.md §2 calls out:
bio, delivery radius, availability schedule, spoken languages, pickup point,
promo banner, verifications checklist, and aggregated review stats.

### `GET /v1/sellers/:id`

**Public.** Returns a seller's public profile, with default stats (zeros)
when no reviews exist yet.

**Success — `200 OK`**
```jsonc
{
  "id": "01HXY...",
  "userId": "cmpe...",
  "displayName": "Mado Beauté",
  "avatarUrl": null,
  "bio": "Je fabrique mes cosmétiques à la main à Gombe depuis 10 ans.",
  "heroUrl": "seller-banners/01HXY.../hero-...jpg" | null,
  "bannerUrl": "seller-banners/01HXY.../banner-...jpg" | null,
  "deliveryRadiusKm": 20,
  "availability": { "mon": "9-18", "tue": "9-18", "wed": null, ... } | null,
  "languages": ["fr", "ln"],
  "pickupPoint": { "lat": -4.3217, "lng": 15.3125 } | null,
  "promo": { "text": "Première commande livrée gratuitement", "expiresAt": null } | null,
  "verifications": [
    { "kind": "IDENTITY", "status": "APPROVED", "verifiedAt": "..." },
    { "kind": "HYGIENE_CHARTER", "status": "PENDING", "verifiedAt": null }
  ],
  "stats": {
    "avgRating": 0,
    "ratingCount": 0,
    "distribution": {},
    "hygieneBar": 0,
    "qualityBar": 0,
    "packagingBar": 0,
    "topSentimentTags": []
  },
  "createdAt": "...",
  "updatedAt": "..."
}
```

`verifications[].kind` ∈ `IDENTITY | HYGIENE_CHARTER | PHONE | ADDRESS`.
`status` ∈ `PENDING | APPROVED | REJECTED`. Stats stay at zero until M8
ships reviews.

### `GET /v1/sellers/me/profile`

**Auth required.** Same shape as the public read. `404` if no profile exists.

### `PUT /v1/sellers/me/profile`

**Auth required.** Creates-or-updates the caller's seller profile. First
call also flips `User.role` from BUYER to SELLER.

**Request — all fields optional**
```jsonc
{
  "bio": "Je fabrique mes cosmétiques à la main…",
  "deliveryRadiusKm": 20,
  "availability": {
    "mon": "9-18" | null, "tue": ..., "wed": ..., "thu": ...,
    "fri": ..., "sat": ..., "sun": ...
  } | null,
  "languages": ["fr", "ln"],
  "pickupPoint": { "lat": -4.32, "lng": 15.31 } | null,
  "promoText": "Première commande livrée gratuitement",
  "promoActive": true,
  "promoExpiresAt": "2026-06-30T23:59:00Z" | null
}
```

**Success — `200 OK`** — full `SellerProfileResponseDto`.

### `POST /v1/sellers/me/profile/image`

Two-step upload for the **banner** or **hero** image. Receive a signed PUT
URL, upload directly, and the URL is committed to your profile automatically
(no follow-up PATCH needed).

**Auth required.**

**Request**
```jsonc
{
  "kind": "banner",                  // 'banner' | 'hero'
  "contentType": "image/jpeg"        // 'image/jpeg' | 'image/png' | 'image/webp'
}
```

**Success — `201 Created`**
```jsonc
{
  "bucket": "seller-banners",
  "path": "<sellerId>/banner-<ulid>.jpg",
  "token": "...",
  "signedUrl": "http://.../storage/v1/object/upload/sign/seller-banners/...?token=...",
  "expectedUrl": "seller-banners/<sellerId>/banner-<ulid>.jpg"
}
```

---

# Listings

Categories (Flutter UI labels in parentheses):

| Code | UI label | Radius cap |
|---|---|---:|
| `COSMETIQUE` | Cosmétique | 25 km |
| `TEXTILE` | Textile | 25 km |
| `SECONDE_MAIN` | Seconde main | 15 km |
| `AGRICOLE` | Agricole | 30 km |
| `SERVICES` | Services | 20 km |
| `AUTRES` | Autres | 25 km |

The radius cap is enforced server-side at search/feed time (M3); the
single-listing endpoint does not filter by it.

**Status machine** — flipped via dedicated endpoints, never PATCH:

```
DRAFT ──publish──▶ PUBLISHED ──archive──▶ ARCHIVED
                    │                       │
                    ▼                       │
                SOLD_OUT (set by orders)    │
                                            │
ARCHIVED ──publish (re-list)──▶ PUBLISHED ◀─┘
```

`DELETE` soft-deletes (sets `deletedAt`, removes from public reads).

---

### `GET /v1/listings/:id`

**Public.** When called with `Authorization: Bearer ...`, the listing is
also recorded in the caller's [recently-viewed](#recently-viewed) set.

**Success — `200 OK`**
```jsonc
{
  "id": "01HXY...",
  "sellerId": "01HXY...",
  "title": "iPhone 13 Pro reconditionné",
  "description": "En parfait état, batterie 92%…",
  "category": "SECONDE_MAIN",
  "priceCents": 69900,
  "currency": "CDF",
  "location": { "lat": -4.3217, "lng": 15.3125 },
  "photos": [
    {
      "id": "01HXY...",
      "url": "listing-photos/<listingId>/<id>.jpg",
      "sm": "listing-photos/<listingId>/<id>_sm.jpg" | null,
      "md": "listing-photos/<listingId>/<id>_md.jpg" | null,
      "lg": "listing-photos/<listingId>/<id>_lg.jpg" | null,
      "alt": "Façade de l'iPhone",
      "uploadedAt": "2026-05-20T...",
      "ready": true
    }
  ],
  "options": { /* free-form */ } | null,
  "quantityAvailable": 1,
  "status": "PUBLISHED",
  "expiresAt": null,
  "publishedAt": "2026-05-20T...",
  "createdAt": "...",
  "updatedAt": "...",
  "seller": {
    "id": "01HXY...",
    "displayName": "Mado Beauté",
    "avatarUrl": null,
    "bannerUrl": "seller-banners/..."
  }
}
```

`photos[].ready` is `false` between upload init and worker completion — UI
should render the original `url` and lazy-load `lg`/`md`/`sm` as they appear.

### `GET /v1/listings/me/owned`

**Auth required.** Every listing owned by the caller (DRAFT, PUBLISHED,
SOLD_OUT, ARCHIVED — but not soft-deleted).

### `POST /v1/listings`

**Auth required + must have a seller profile** (else `403`).

Creates a listing in `DRAFT` status. Call `/publish` to make it live.

**Request**
```jsonc
{
  "title": "iPhone 13 Pro reconditionné",       // 3-140 chars
  "description": "En parfait état, batterie 92%…", // 10-5000 chars
  "category": "SECONDE_MAIN",
  "priceCents": 69900,
  "currency": "CDF",                             // optional, default 'CDF'
  "lat": -4.3217,
  "lng": 15.3125,
  "quantityAvailable": 1,                        // optional, default 1
  "options": { "color": "graphite" },            // optional, free-form
  "expiresAt": "2026-06-30T23:59:00Z"            // optional ISO 8601
}
```

**Success — `201 Created`** — full `ListingResponseDto`.

**Errors**
- `400` `BOMBOLI_VALIDATION_FAILED`
- `403` if the caller has no seller profile

### `PATCH /v1/listings/:id`

**Auth required. Owner-only.** Partial update. `lat` and `lng` must be sent
together (or both omitted). Cannot change `status` — use the dedicated
transitions.

### `POST /v1/listings/:id/publish`

**Auth required. Owner-only.** Flips DRAFT (or ARCHIVED) → PUBLISHED, stamps
`publishedAt`. Idempotent on already-PUBLISHED.

**Success — `201 Created`** — the updated listing.

**Errors**
- `409` if the current status doesn't allow publishing

### `POST /v1/listings/:id/archive`

**Auth required. Owner-only.** Flips PUBLISHED (or DRAFT/SOLD_OUT) → ARCHIVED.

### `DELETE /v1/listings/:id`

**Auth required. Owner-only.** Soft-delete. Public reads return `404`
afterwards. Recovery requires admin action (M11).

**Success — `204 No Content`.**

---

# Listing photos

Two-step upload protocol. Same pattern as avatars but with a separate
**commit** step that enqueues background processing.

```
1. POST /v1/listings/:id/photos             → { photoId, signedUrl, path, ... }
2. PUT  <signedUrl>   (client uploads binary directly to Storage)
3. POST /v1/listings/:id/photos/:photoId/commit
   ↳ enqueues image-processing job → worker generates sm/md/lg variants
   ↳ a few seconds later, photos[].ready flips to true via the same listing read
```

Max **10 photos per listing**. The pending entry is created on init, so a
photo appears in `listing.photos[]` immediately with `ready: false`.

### `POST /v1/listings/:id/photos`

**Auth required. Owner-only.**

**Request**
```jsonc
{
  "contentType": "image/jpeg",       // 'image/jpeg' | 'image/png' | 'image/webp'
  "alt": "Façade de l'iPhone"        // optional, max 140 chars
}
```

**Success — `201 Created`**
```jsonc
{
  "photoId": "01HXY...",
  "bucket": "listing-photos",
  "path": "<listingId>/<photoId>.jpg",
  "signedUrl": "http://.../storage/v1/object/upload/sign/listing-photos/...?token=...",
  "token": "..."
}
```

After uploading the binary to `signedUrl`, call commit.

### `POST /v1/listings/:id/photos/:photoId/commit`

**Auth required. Owner-only.** Marks the photo as uploaded and enqueues
variant generation. Returns the photo entry; `ready` will still be `false`
until the worker finishes (typically <5s).

### `DELETE /v1/listings/:id/photos/:photoId`

**Auth required. Owner-only.** Removes the photo entry and best-effort
deletes every variant from storage.

**Success — `204 No Content`.**

---

# Search

Full-text + proximity search over published listings. Postgres `tsvector`
with a French dictionary plus `pg_trgm` fuzzy fallback for typo tolerance.
Per-category radius caps apply automatically — a `SECONDE_MAIN` listing 22 km
away will never appear, even if the caller asks for 30 km.

Soft-deleted, DRAFT, ARCHIVED, and expired listings are excluded.

### `GET /v1/search`

**Public.**

| Param | Type | Notes |
|---|---|---|
| `q` | string, ≤140 chars | Full-text query. Fuzzy fallback on title (trigram similarity > 0.25). |
| `category` | enum | One of the 6 listing categories. |
| `maxDistanceKm` | number, 0.1–30 | Combined with the per-category cap — the smaller wins. Requires `lat`/`lng`. |
| `lat`, `lng` | numbers | Must be sent together. Required if `maxDistanceKm` or `sort=distance` is used. |
| `sort` | enum | `relevance` (default when `q` is present), `newest`, `priceAsc`, `priceDesc`, `distance`. |
| `offset` | int ≥0, ≤1000 | Default 0. |
| `limit` | int 1–50 | Default 20. |

At least one of `q`, `category`, or `lat`/`lng` is required. Without any
filter, the API returns `400 BOMBOLI_VALIDATION_FAILED`.

**Success — `200 OK`**
```jsonc
{
  "results": [ListingResponseDto, ...],
  "total": 42,
  "offset": 0,
  "limit": 20,
  "hasMore": true
}
```

Each result is the full [`ListingResponseDto`](#get-v1listingsid) including
the seller summary, so the Flutter card UI doesn't need an extra fetch per
result.

**Examples**

Browse all "Seconde main" within 5 km of the user, cheapest first:
```
GET /v1/search?category=SECONDE_MAIN&lat=-4.3217&lng=15.3125&maxDistanceKm=5&sort=priceAsc
```

Search for "iphone" anywhere by relevance:
```
GET /v1/search?q=iphone
```

Search "savon noir" near me, sorted by distance:
```
GET /v1/search?q=savon%20noir&lat=-4.3217&lng=15.3125&sort=distance
```

---

# Home feed

One endpoint returns all six home-screen rails so the Flutter home screen
makes a single API call. Proximity rails require `lat`/`lng`; without
coords those rails return `[]`. The `vuRecemment` rail is populated from
the caller's [recently-viewed](#recently-viewed) Redis set — empty for
unauthenticated callers.

### `GET /v1/feed`

**Public** (with opportunistic auth for `vuRecemment`).

| Param | Type | Notes |
|---|---|---|
| `lat`, `lng` | numbers | Must be sent together. Without them, proximity rails return `[]`. |
| `limit` | int 1–20 | Per-rail cap, default 10. |

**Success — `200 OK`**
```jsonc
{
  "aDecouvrir":         [ListingResponseDto, ...],
  "bonsPlans":          [ListingResponseDto, ...],
  "bientotTermine":     [ListingResponseDto, ...],
  "servicesPresDeToi":  [ListingResponseDto, ...],
  "vendeursProches": [
    {
      "id": "01HXY...",
      "displayName": "Mado Beauté",
      "avatarUrl": null,
      "bannerUrl": "seller-banners/...",
      "distanceKm": 2.4
    }
  ],
  "vuRecemment":        [ListingResponseDto, ...]
}
```

| Rail | What it returns |
|---|---|
| `aDecouvrir` | Recently-published listings within each listing's per-category radius, newest first. |
| `bonsPlans` | Listings priced in the bottom quartile of their category, published in the last 30 days. |
| `bientotTermine` | Low-stock (≤ 2 left) OR expiring within 48 h. |
| `servicesPresDeToi` | `category = SERVICES`, sorted by ascending distance. |
| `vendeursProches` | Distinct sellers with at least one PUBLISHED listing within 30 km, sorted by their nearest listing's distance. |
| `vuRecemment` | The caller's recently-viewed listings (newest first). Empty without auth. |

The proximity rails enforce the per-category radius cap on every listing
(a `SECONDE_MAIN` listing past 15 km will not appear in `aDecouvrir`, even
though `aDecouvrir` itself has no global radius).

---

# Cart

Each user has a single persistent cart. The most important invariant: **a
cart contains items from exactly one seller at a time**. Adding a listing
from a different seller returns `409 BOMBOLI_CART_SELLER_CONFLICT` and the
client must call `POST /v1/cart/replace` to swap.

The cart is auto-created on first read, so the Flutter app gets a stable
`id` from day one. Removing the last item resets `sellerId` and `currency`
to `null`.

The cart shows **current** listing prices (re-read on every GET); the
**snapshotted** prices that go into an order are taken at order creation time
(see [Orders](#orders)).

### Cart response shape

```jsonc
{
  "id": "cmpe...",
  "sellerId": "01HXY..." | null,
  "currency": "CDF" | null,
  "seller": { "id": "...", "displayName": "...", "avatarUrl": null, "bannerUrl": null } | null,
  "items": [
    {
      "id": "cmpe...",
      "listing": {
        "id": "01HXY...",
        "title": "iPhone 13 Pro reconditionné",
        "priceCents": 69900,
        "currency": "CDF",
        "primaryPhotoUrl": "listing-photos/.../<id>.jpg" | null,
        "status": "PUBLISHED"
      },
      "quantity": 2,
      "options": { ... } | null,
      "lineTotalCents": 139800
    }
  ],
  "itemCount": 2,
  "subtotalCents": 139800
}
```

### `GET /v1/cart`

**Auth required.** Returns the caller's cart. Auto-creates an empty cart for
first-time callers.

### `POST /v1/cart/items`

**Auth required.**

```jsonc
{
  "listingId": "01HXY...",
  "quantity": 1,              // 1-50, default 1
  "options": { "size": "L" }  // optional, free-form
}
```

**Success — `200 OK`** — full cart response.

- Re-adding the same listing **increments** the quantity (upsert by
  `(cart, listing)`).
- Adding from a different seller returns `409 BOMBOLI_CART_SELLER_CONFLICT`.
- Adding a non-PUBLISHED listing returns `409 BOMBOLI_CONFLICT`.

### `PATCH /v1/cart/items/:id`

**Auth required. Owner-only.**

```jsonc
{ "quantity": 3 }   // 1-50
```

**Success — `200 OK`** — full cart response.

### `DELETE /v1/cart/items/:id`

**Auth required. Owner-only.**

**Success — `200 OK`** — full cart response (200, not 204, so the client gets
the updated cart in one round-trip).

### `POST /v1/cart/replace`

**Auth required.** Atomically clears the cart and adds a single item. Used by
the "switch seller" UX after the user confirms the swap dialog.

```jsonc
{
  "listingId": "01HXY...",
  "quantity": 1,
  "options": { ... }
}
```

**Success — `200 OK`** — full cart response with the new seller.

---

# Orders

The transactional core. Each order represents a single cart's worth of
items from one seller, with a status machine the seller drives forward and
either party can cancel (with role-specific gates).

**Status machine** — every transition emits a domain event that
notifications (M9), chat system messages (M7), and stats (M8) subscribe to:

```
PREPARING ──seller /status──▶ ON_THE_WAY ──seller /status──▶ DELIVERED
   │                              │                              │
   └──── buyer or seller /cancel ─┴── seller-only /cancel ─┐     │
                                                            ▼     ▼
                                                       CANCELLED  REFUNDED
```

Cancellation restocks the listings (and unsets `SOLD_OUT` if applicable).

**Idempotency.** `POST /v1/orders` requires an `Idempotency-Key` header — a
network retry will replay the same response, never decrement inventory
twice. See [Common conventions](#common-conventions).

### Order response shape

```jsonc
{
  "id": "cmpe...",
  "buyerId": "cmpe...",
  "sellerId": "01HXY...",
  "seller": { "id": "...", "displayName": "...", "avatarUrl": null, "bannerUrl": "..." } | null,
  "status": "PREPARING",                   // PREPARING|ON_THE_WAY|DELIVERED|CANCELLED|REFUNDED
  "fulfillmentType": "DELIVERY",           // DELIVERY|PICKUP
  "addressSnapshot": {                     // null for PICKUP
    "label": "home",
    "formatted": "12 Avenue Lumumba, Kinshasa",
    "lat": -4.3217,
    "lng": 15.3125,
    "gateCode": "#4521",
    "floor": "3",
    "deliveryInstructions": "Sonner deux fois"
  },
  "subtotalCents": 69900,
  "discountCents": 0,                      // populated in M10
  "deliveryFeeCents": 500,
  "totalCents": 70400,
  "currency": "CDF",
  "etaAt": "2026-05-20T18:30:00Z" | null,
  "delivererId": null,                     // populated in M6
  "paymentId": null,                       // populated in M5
  "items": [
    {
      "id": "cmpe...",
      "listingId": "01HXY...",
      "titleSnapshot": "iPhone 13 Pro reconditionné",
      "priceCentsSnapshot": 69900,
      "photoUrlSnapshot": "listing-photos/.../<id>.jpg",
      "quantity": 1,
      "options": null,
      "lineTotalCents": 69900
    }
  ],
  "createdAt": "...",
  "updatedAt": "..."
}
```

### `POST /v1/orders`

Create an order from the caller's current cart. **Requires
`Idempotency-Key` header.** Atomic: locks each listing's row, snapshots
prices and addresses, decrements inventory (auto-flips to `SOLD_OUT` on
zero), clears the cart, and emits `order.created` after commit.

**Auth required.**

**Request**
```jsonc
{
  "fulfillmentType": "DELIVERY",        // 'DELIVERY' | 'PICKUP'
  "addressId": "01HXY...",              // required when fulfillmentType=DELIVERY
  "deliveryFeeCents": 500,              // optional, only used for DELIVERY
  "note": "Sonner discrètement"         // optional, max 500 chars
}
```

**Success — `201 Created`** — full order response.

**Errors**
- `400 BOMBOLI_VALIDATION_FAILED` — missing `addressId` for DELIVERY
- `409 BOMBOLI_CONFLICT` — cart is empty or a listing is no longer PUBLISHED
- `409 BOMBOLI_OUT_OF_STOCK` — requested quantity exceeds inventory
- `404` — `addressId` not found / not yours

### `GET /v1/orders`

List orders. Defaults to the caller's buyer view; pass `?role=seller` to
see incoming orders for the caller's seller profile.

**Auth required.**

| Param | Type | Notes |
|---|---|---|
| `role` | `buyer` (default) \| `seller` | |
| `status` | order status enum | Optional filter. |
| `offset` | int ≥0, ≤1000 | Default 0. |
| `limit` | int 1–50 | Default 20. |

**Success — `200 OK`**
```jsonc
{
  "results": [OrderResponseDto, ...],
  "total": 7,
  "offset": 0,
  "limit": 20,
  "hasMore": false
}
```

### `GET /v1/orders/:id`

**Auth required.** Accessible to both the buyer and the order's seller.
`403` otherwise.

### `POST /v1/orders/:id/status`

**Auth required. Seller-only.** Forward transition (PREPARING → ON_THE_WAY
→ DELIVERED). Other transitions return `409 BOMBOLI_INVALID_ORDER_TRANSITION`.
Use `/cancel` for cancellations.

```jsonc
{
  "to": "ON_THE_WAY",                       // 'ON_THE_WAY' | 'DELIVERED'
  "etaAt": "2026-05-20T18:30:00Z"           // optional ISO 8601
}
```

**Success — `200 OK`** — full order response.

### `POST /v1/orders/:id/cancel`

**Auth required.** Buyer or seller, status-aware:
- Buyer can cancel **only while PREPARING.** Past that, `403`.
- Seller can cancel until DELIVERED. After DELIVERED, `409`.
- Cancellation restocks every order item.

```jsonc
{ "reason": "Changed my mind" }    // optional, max 500 chars
```

**Success — `200 OK`** — full order response with `status: 'CANCELLED'`.

**Errors**
- `403` — buyer trying to cancel an ON_THE_WAY order
- `409 BOMBOLI_INVALID_ORDER_TRANSITION` — already CANCELLED, REFUNDED, or DELIVERED

---

# Payments

Four payment providers behind a single `POST /v1/orders/:id/payment`
endpoint:

| Provider | Use case | Flow |
|---|---|---|
| `STRIPE` | International cards (diaspora) | Server creates a PaymentIntent → client uses `clientSecret` + Stripe SDK → Stripe webhook drives state. |
| `PAYPAL` | Web checkout | Server creates a PayPal Order → client redirects to `approveUrl` → on return, client calls `/confirm` to capture → PayPal webhook also drives state. |
| `PAWAPAY` | Mobile Money (Vodacom M-Pesa, Orange Money, Airtel Money) | Server initiates a USSD-push deposit → user enters PIN on phone → Pawapay webhook confirms. |
| `MANUAL` | Cash on pickup / out-of-band Mobile Money | Server records intent → admin manually confirms via `/v1/admin/payments/manual-confirm`. |

Each order has exactly one Payment (1:1). Repeated `POST /payment` calls
return the existing PENDING payment if one exists, or `409` if it's in a
terminal state (SUCCEEDED, FAILED, CANCELLED, REFUNDED). To retry a failed
payment, the buyer must start a new order.

**Idempotency.** `POST /v1/orders/:id/payment` requires an `Idempotency-Key`
header — the same key replays the cached response and (when supported by
the provider) forwards as the provider's idempotency key so retries never
double-charge.

**Auto-cancel on failure.** When a provider reports payment failure, the
backend automatically cancels the order and restocks inventory. This
happens asynchronously via the `payment.failed` event.

**Provider availability.** Each provider can be enabled independently via
env vars. Calling a disabled provider returns `503 BOMBOLI_AUTH_PROVIDER_ERROR`.
The Manual provider is always available.

---

### Payment response shape

```jsonc
{
  "id": "cmpe...",
  "orderId": "cmpe...",
  "provider": "STRIPE",                  // STRIPE|PAYPAL|PAWAPAY|MANUAL
  "providerRef": "pi_3O...",             // upstream identifier
  "amountCents": 70400,
  "currency": "CDF",
  "status": "PENDING",                   // PENDING|SUCCEEDED|FAILED|CANCELLED|REFUNDED
  "capturedAt": "..." | null,
  "failureReason": "Card declined" | null,
  "clientPayload": {                     // provider-specific; the client uses these to finish
    "clientSecret": "pi_..._secret_...", // Stripe
    "publishableKey": "pk_test_..."
    // or { "approveUrl": "https://www.paypal.com/..." } for PayPal
    // or { "depositId": "...", "message": "..." } for Pawapay
    // or { "message": "Paiement à effectuer hors plateforme." } for Manual
  },
  "createdAt": "...",
  "updatedAt": "..."
}
```

### `POST /v1/orders/:id/payment`

Initiate payment for an existing order. **Requires `Idempotency-Key`.**
**Owner-only** (the order's buyer).

**Request — discriminated by `provider`:**

```jsonc
// Stripe
{ "provider": "STRIPE" }

// PayPal (returnUrl + cancelUrl required)
{
  "provider": "PAYPAL",
  "returnUrl": "https://app.bomboli/payment-return",
  "cancelUrl": "https://app.bomboli/payment-cancel"
}

// Pawapay (phone + operator required)
{
  "provider": "PAWAPAY",
  "phone": "+243812345678",
  "operator": "VODACOM_MPESA_COD"   // VODACOM_MPESA_COD | ORANGE_COD | AIRTEL_OAPI_COD
}

// Manual
{ "provider": "MANUAL" }
```

**Success — `201 Created`** — full payment response (see above).

**Errors**
- `400 BOMBOLI_VALIDATION_FAILED` — missing provider-specific fields
- `403` — order doesn't belong to caller
- `409 BOMBOLI_CONFLICT` — order is in CANCELLED/REFUNDED state, or already has a non-PENDING payment
- `503 BOMBOLI_AUTH_PROVIDER_ERROR` — provider isn't configured on the server

### `GET /v1/payments/:id`

**Auth required.** Accessible to both the buyer of the order and the
order's seller. `403` otherwise.

### `POST /v1/payments/:id/confirm`

**Auth required. Owner-only (buyer).** Client-driven capture step. Only
PayPal currently uses this — the client calls it after the user returns
from the PayPal approval URL.

```jsonc
{ "providerRef": "5O7..."  /* PayPal order id; optional if stored */ }
```

**Success — `200 OK`** — updated payment.

**Errors**
- `409` — payment isn't PENDING, or provider doesn't support explicit confirm

---

## Admin payment endpoints

Admin-only (`@Roles('ADMIN')`); every action is audit-logged.

### `POST /v1/admin/payments/manual-confirm`

Mark a MANUAL payment as `SUCCEEDED`. Records `externalRef` in the audit
log (USSD transaction id, cash receipt number, etc.).

```jsonc
{
  "paymentId": "cmpe...",
  "externalRef": "USSD-tx-12345",      // optional
  "note": "Cash received at pickup"    // optional
}
```

**Success — `200 OK`** — payment with `status: 'SUCCEEDED'`.

**Errors**
- `409` — payment isn't MANUAL, or already in a terminal state

### `POST /v1/admin/payments/:id/refund`

Refund a `SUCCEEDED` payment. Routes to the original provider's refund API
(Stripe/PayPal/Pawapay); Manual just flips bookkeeping.

```jsonc
{
  "amountCents": 5000,                  // optional — full refund if omitted
  "reason": "Damaged on delivery"       // optional
}
```

**Success — `200 OK`** — payment with `status: 'REFUNDED'`.

**Errors**
- `409` — payment isn't SUCCEEDED

---

## Provider webhooks

Internal endpoints that receive provider callbacks. **Each requires a
valid provider signature.** Configure these URLs in each provider's
dashboard.



| Endpoint | Provider | Signature header(s) | Required env vars |
|---|---|---|---|
| `POST /v1/internal/stripe/webhook` | Stripe | `Stripe-Signature` | `STRIPE_WEBHOOK_SECRET` |
| `POST /v1/internal/paypal/webhook` | PayPal | `PayPal-Transmission-Id`, `PayPal-Transmission-Time`, `PayPal-Cert-Url`, `PayPal-Auth-Algo`, `PayPal-Transmission-Sig` | `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID` |
| `POST /v1/internal/pawapay/webhook` | Pawapay | `X-Pawapay-Signature` (HMAC-SHA256 of body) | `PAWAPAY_WEBHOOK_SECRET` |

All return `204 No Content` on accepted events (including `ignored` event
types like Stripe's `customer.created`). Signature failures return `401`.

The Flutter app **never calls these endpoints directly** — they're for
the providers' own callbacks.

---

# Deliveries

Delivery scaffolding for the pilot: deliverer roster managed by admin,
deliverer self-service for location and availability, ETA stamped on
assignment.

**Pilot model.** A `User` becomes a deliverer when an admin creates a
`Deliverer` profile for them via `POST /v1/admin/deliverers`. The user's
role flips to `DELIVERY_PARTNER` automatically. Self-service registration
isn't supported — onboarding is curated.

**ETA.** Computed at assignment time as a great-circle (Haversine) distance
between the seller's pickup point (or the listing's location, if no
pickup point is set) and the delivery address, multiplied by **15 minutes
per kilometer** (the Kinshasa-traffic pilot constant). Minimum ETA: 5
minutes.

**Status transitions.** The assigned deliverer can advance the order
status (`POST /v1/orders/:id/status` — see [Orders](#orders)). Sellers
retain the same ability — both can move PREPARING → ON_THE_WAY → DELIVERED.

---

### Deliverer response shape

```jsonc
{
  "id": "cmpe...",
  "userId": "cmpe...",
  "displayName": "Patrick Nguz",
  "avatarUrl": null,
  "vehicleType": "MOTO",                 // 'MOTO' | 'VOITURE' | 'VELO' | 'A_PIED'
  "phoneMasked": "+243•••5678",
  "available": true,
  "currentLocation": { "lat": -4.3217, "lng": 15.3125 } | null,
  "createdAt": "...",
  "updatedAt": "..."
}
```

**Public summary** embedded on order responses (buyer-safe — no full phone,
no live location):

```jsonc
"deliverer": {
  "id": "cmpe...",
  "displayName": "Patrick Nguz",
  "avatarUrl": null,
  "vehicleType": "MOTO",
  "phoneMasked": "+243•••5678"
}
```

---

## Admin endpoints

Admin-only (`@Roles('ADMIN')`); roster operations are audit-logged.

### `POST /v1/admin/deliverers`

Create a deliverer profile for an existing user. Promotes their role to
`DELIVERY_PARTNER` and stores the masked phone.

```jsonc
{
  "userId": "cmpe...",
  "vehicleType": "MOTO",                 // 'MOTO' | 'VOITURE' | 'VELO' | 'A_PIED'
  "phone": "+243812345678"                // E.164; server masks to last 4 digits
}
```

**Success — `201 Created`** — full `DelivererResponseDto`.

**Errors**
- `404` — user not found
- `409 BOMBOLI_CONFLICT` — user already has a deliverer profile

### `GET /v1/admin/deliverers`

List deliverers. Use `?onlyAvailable=true` to filter to currently available
ones (e.g. for the assignment UI).

**Success — `200 OK`** — `[DelivererResponseDto, ...]`.

### `POST /v1/admin/orders/:id/assign-deliverer`

Assign a deliverer to a `DELIVERY`-fulfillment order. Computes ETA from
pickup → destination distance.

```jsonc
{ "delivererId": "cmpe..." }
```

**Success — `200 OK`**
```jsonc
{
  "orderId": "cmpe...",
  "delivererId": "cmpe...",
  "etaAt": "2026-05-20T19:00:00Z",
  "distanceKm": 4.2
}
```

After assignment, the order response includes the [public deliverer
summary](#deliveries) and a populated `etaAt`.

**Errors**
- `404` — order or deliverer not found
- `409 BOMBOLI_CONFLICT` — order is `PICKUP` (no delivery needed), not in
  `PREPARING` status, or has no address snapshot

---

## Deliverer self endpoints

Available to the deliverer themselves (auth-only; gated by ownership of a
`Deliverer` profile — returns `404` otherwise).

### `GET /v1/deliveries/me`

Returns the caller's deliverer profile.

**Errors**
- `404` — the caller has no deliverer profile

### `PATCH /v1/deliveries/me/location`

Update the deliverer's current GPS — the deliverer mobile app calls this
periodically while on a route.

```jsonc
{ "lat": -4.3217, "lng": 15.3125 }
```

**Success — `200 OK`** — full `DelivererResponseDto`.

### `PATCH /v1/deliveries/me/available`

Toggle availability. Off-shift deliverers should set `available: false`
so the admin's assignment UI doesn't pick them.

```jsonc
{ "available": true }
```

**Success — `200 OK`** — full `DelivererResponseDto`.

---

# Health & ops

### `GET /v1/health`

**Public.** Liveness check — returns `{ status: "ok", uptime, env }`. Useful
for splash-screen connectivity probes.

### `GET /v1/health/ready`

**Public.** Readiness — pings the database and Redis. Returns 503 if either
is down.

### `GET /v1/health/metrics`

**Public** in non-production; token-gated in production (`Authorization: Bearer
<METRICS_TOKEN>`). Prometheus text exposition format. Not meant for the
mobile app — internal use by ops.

---

## Appendix — what to expect next

These endpoints are scheduled in [`v1-roadmap.md`](./v1-roadmap.md):

| Milestone | Endpoints |
|---|---|
| ~~M2~~ | ~~Sellers (`/v1/sellers/...`), listings (`/v1/listings/...`), photo upload~~ — **shipped** |
| ~~M3~~ | ~~Search (`/v1/search`), home feed rails (`/v1/feed`)~~ — **shipped** |
| ~~M4~~ | ~~Cart (`/v1/cart`), orders (`/v1/orders`)~~ — **shipped** |
| ~~M5~~ | ~~Payments (PayPal, Mobile Money via Pawapay, Stripe)~~ — **shipped** |
| ~~M6~~ | ~~Delivery assignment + status updates~~ — **shipped** |
| M7 | Chat threads + messages (over Supabase Realtime) |
| M8 | Reviews + sentiment tags |
| M9 | Notifications (push + in-app feed) |
| M10 | Promos + wallet |
| M11 | Admin (under `/v1/admin/...`) |

Once each milestone ships, the corresponding section is appended to this
document.

---

## Versioning of this document

When endpoint contracts change in ways the Flutter client must handle, the
change is called out in a `CHANGELOG.md` section appended below.

### Changelog

- **2026-05-20** — initial publication. Covers M0 (auth) + M1 (profile,
  addresses, devices, recently-viewed scaffold).
- **2026-05-20** — **M2** appended: sellers (profile + verifications + stats
  with default zeros), listings (CRUD + status machine + soft-delete),
  listing photos (two-step upload + background variant generation), and the
  recently-viewed write wired on `GET /v1/listings/:id`.
- **2026-05-20** — **M3** appended: `GET /v1/search` (Postgres full-text in
  French + pg_trgm fuzzy fallback + per-category radius cap + offset
  pagination), `GET /v1/feed` (all 6 home rails in one shot).
- **2026-05-20** — **M4** appended: cart with single-seller invariant
  (`/v1/cart`, `/v1/cart/items`, `/v1/cart/replace`), orders with atomic
  inventory decrement and full status machine
  (`/v1/orders`, `/v1/orders/:id/status`, `/v1/orders/:id/cancel`).
  `Idempotency-Key` required on order creation. Domain events emitted on
  every status transition.
- **2026-05-21** — **M5** appended: payments with four providers
  (Stripe, PayPal, Pawapay Mobile Money, Manual). One payment per order,
  state machine PENDING → SUCCEEDED/FAILED/CANCELLED → REFUNDED. Webhook
  endpoints with signature verification at `/v1/internal/{stripe,paypal,pawapay}/webhook`.
  Admin manual-confirm + refund endpoints (audit-logged). `payment.failed`
  event auto-cancels the order.
- **2026-05-21** — **M6** appended: deliverers. Admin-driven roster
  (`POST /v1/admin/deliverers`, `GET /v1/admin/deliverers`). Assignment
  endpoint stamps ETA via Haversine × 15 min/km
  (`POST /v1/admin/orders/:id/assign-deliverer`). Deliverer self endpoints
  (`/v1/deliveries/me`, `/location`, `/available`). Assigned deliverer can
  drive the order status alongside the seller. `Order.deliverer` summary
  surfaced to buyer (masked phone, no live location).
