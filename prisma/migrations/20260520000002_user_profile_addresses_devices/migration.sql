-- User: profile preferences + last-known GPS
ALTER TABLE "users"
  ADD COLUMN "avatarUrl"         TEXT,
  ADD COLUMN "preferredLanguage" TEXT NOT NULL DEFAULT 'fr',
  ADD COLUMN "themePref"         TEXT NOT NULL DEFAULT 'system',
  ADD COLUMN "defaultLocation"   geography(Point, 4326);

-- Addresses
CREATE TABLE "addresses" (
  "id"                   TEXT NOT NULL,
  "userId"               TEXT NOT NULL,
  "label"                TEXT NOT NULL,
  "formatted"            TEXT NOT NULL,
  "location"             geography(Point, 4326) NOT NULL,
  "gateCode"             TEXT,
  "floor"                TEXT,
  "deliveryInstructions" TEXT,
  "isDefault"            BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL,
  CONSTRAINT "addresses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "addresses_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "addresses_userId_idx" ON "addresses"("userId");
CREATE INDEX "addresses_location_gix" ON "addresses" USING GIST ("location");

-- At most one default address per user.
CREATE UNIQUE INDEX "addresses_user_default_unique"
  ON "addresses" ("userId")
  WHERE "isDefault" = TRUE;

-- Devices (push token registry)
CREATE TABLE "devices" (
  "id"         TEXT NOT NULL,
  "userId"     TEXT NOT NULL,
  "platform"   TEXT NOT NULL,
  "pushToken"  TEXT NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "devices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "devices_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "devices_pushToken_key" ON "devices"("pushToken");
CREATE INDEX "devices_userId_idx" ON "devices"("userId");
