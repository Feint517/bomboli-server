-- Enums
CREATE TYPE "VerificationKind" AS ENUM ('IDENTITY', 'HYGIENE_CHARTER', 'PHONE', 'ADDRESS');
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "ListingCategory" AS ENUM (
  'COSMETIQUE', 'TEXTILE', 'SECONDE_MAIN', 'AGRICOLE', 'SERVICES', 'AUTRES'
);
CREATE TYPE "ListingStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SOLD_OUT', 'ARCHIVED');

-- SellerProfile
CREATE TABLE "seller_profiles" (
  "id"               TEXT NOT NULL,
  "userId"           TEXT NOT NULL,
  "bio"              TEXT,
  "heroUrl"          TEXT,
  "bannerUrl"        TEXT,
  "deliveryRadiusKm" INTEGER NOT NULL DEFAULT 15,
  "availability"     JSONB,
  "languages"        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "pickupPoint"      geography(Point, 4326),
  "promoText"        TEXT,
  "promoActive"      BOOLEAN NOT NULL DEFAULT FALSE,
  "promoExpiresAt"   TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "seller_profiles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "seller_profiles_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "seller_profiles_userId_key" ON "seller_profiles"("userId");
CREATE INDEX "seller_profiles_pickup_gix" ON "seller_profiles" USING GIST ("pickupPoint");

-- Verifications
CREATE TABLE "verifications" (
  "id"          TEXT NOT NULL,
  "sellerId"    TEXT NOT NULL,
  "kind"        "VerificationKind" NOT NULL,
  "status"      "VerificationStatus" NOT NULL DEFAULT 'PENDING',
  "evidenceUrl" TEXT,
  "verifiedAt"  TIMESTAMP(3),
  "verifiedBy"  TEXT,
  "notes"       TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "verifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "verifications_sellerId_fkey"
    FOREIGN KEY ("sellerId") REFERENCES "seller_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "verifications_sellerId_kind_key"
  ON "verifications"("sellerId", "kind");
CREATE INDEX "verifications_status_kind_idx" ON "verifications"("status", "kind");

-- SellerStats
CREATE TABLE "seller_stats" (
  "sellerId"         TEXT NOT NULL,
  "avgRating"        DOUBLE PRECISION NOT NULL DEFAULT 0,
  "ratingCount"      INTEGER NOT NULL DEFAULT 0,
  "distribution"     JSONB NOT NULL DEFAULT '{}'::jsonb,
  "hygieneBar"       DOUBLE PRECISION NOT NULL DEFAULT 0,
  "qualityBar"       DOUBLE PRECISION NOT NULL DEFAULT 0,
  "packagingBar"     DOUBLE PRECISION NOT NULL DEFAULT 0,
  "topSentimentTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "seller_stats_pkey" PRIMARY KEY ("sellerId"),
  CONSTRAINT "seller_stats_sellerId_fkey"
    FOREIGN KEY ("sellerId") REFERENCES "seller_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Listings
CREATE TABLE "listings" (
  "id"                TEXT NOT NULL,
  "sellerId"          TEXT NOT NULL,
  "title"             TEXT NOT NULL,
  "description"       TEXT NOT NULL,
  "category"          "ListingCategory" NOT NULL,
  "priceCents"        INTEGER NOT NULL,
  "currency"          TEXT NOT NULL DEFAULT 'CDF',
  "location"          geography(Point, 4326) NOT NULL,
  "photos"            JSONB NOT NULL DEFAULT '[]'::jsonb,
  "options"           JSONB,
  "quantityAvailable" INTEGER NOT NULL DEFAULT 1,
  "status"            "ListingStatus" NOT NULL DEFAULT 'DRAFT',
  "expiresAt"         TIMESTAMP(3),
  "publishedAt"       TIMESTAMP(3),
  "deletedAt"         TIMESTAMP(3),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "listings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "listings_sellerId_fkey"
    FOREIGN KEY ("sellerId") REFERENCES "seller_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "listings_sellerId_idx" ON "listings"("sellerId");
CREATE INDEX "listings_category_status_idx" ON "listings"("category", "status");
CREATE INDEX "listings_status_publishedAt_idx" ON "listings"("status", "publishedAt");
CREATE INDEX "listings_location_gix" ON "listings" USING GIST ("location");
