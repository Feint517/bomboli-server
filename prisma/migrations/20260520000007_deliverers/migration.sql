-- Add DELIVERY_PARTNER to UserRole enum
ALTER TYPE "UserRole" ADD VALUE 'DELIVERY_PARTNER';

-- VehicleType enum
CREATE TYPE "VehicleType" AS ENUM ('MOTO', 'VOITURE', 'VELO', 'A_PIED');

-- Deliverer table
CREATE TABLE "deliverers" (
  "id"              TEXT NOT NULL,
  "userId"          TEXT NOT NULL,
  "vehicleType"     "VehicleType" NOT NULL,
  "phoneMasked"     TEXT NOT NULL,
  "currentLocation" geography(Point, 4326),
  "available"       BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "deliverers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "deliverers_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "deliverers_userId_key" ON "deliverers"("userId");
CREATE INDEX "deliverers_available_idx" ON "deliverers"("available");
CREATE INDEX "deliverers_currentLocation_gix" ON "deliverers" USING GIST ("currentLocation");
