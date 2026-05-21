-- Enums
CREATE TYPE "OrderStatus" AS ENUM ('PREPARING', 'ON_THE_WAY', 'DELIVERED', 'CANCELLED', 'REFUNDED');
CREATE TYPE "FulfillmentType" AS ENUM ('DELIVERY', 'PICKUP');

-- Cart
CREATE TABLE "carts" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "sellerId"  TEXT,
  "currency"  TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "carts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "carts_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "carts_sellerId_fkey"
    FOREIGN KEY ("sellerId") REFERENCES "seller_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "carts_userId_key" ON "carts"("userId");

-- CartItem
CREATE TABLE "cart_items" (
  "id"        TEXT NOT NULL,
  "cartId"    TEXT NOT NULL,
  "listingId" TEXT NOT NULL,
  "quantity"  INTEGER NOT NULL,
  "options"   JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cart_items_cartId_fkey"
    FOREIGN KEY ("cartId") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "cart_items_listingId_fkey"
    FOREIGN KEY ("listingId") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "cart_items_cartId_listingId_key" ON "cart_items"("cartId", "listingId");
CREATE INDEX "cart_items_cartId_idx" ON "cart_items"("cartId");

-- Order
CREATE TABLE "orders" (
  "id"               TEXT NOT NULL,
  "buyerId"          TEXT NOT NULL,
  "sellerId"         TEXT NOT NULL,
  "status"           "OrderStatus" NOT NULL DEFAULT 'PREPARING',
  "fulfillmentType"  "FulfillmentType" NOT NULL,
  "addressSnapshot"  JSONB,
  "subtotalCents"    INTEGER NOT NULL,
  "discountCents"    INTEGER NOT NULL DEFAULT 0,
  "deliveryFeeCents" INTEGER NOT NULL DEFAULT 0,
  "totalCents"       INTEGER NOT NULL,
  "currency"         TEXT NOT NULL DEFAULT 'CDF',
  "etaAt"            TIMESTAMP(3),
  "delivererId"      TEXT,
  "paymentId"        TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "orders_buyerId_fkey"
    FOREIGN KEY ("buyerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "orders_sellerId_fkey"
    FOREIGN KEY ("sellerId") REFERENCES "seller_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "orders_buyerId_createdAt_idx" ON "orders"("buyerId", "createdAt" DESC);
CREATE INDEX "orders_sellerId_status_idx" ON "orders"("sellerId", "status");
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- OrderItem
CREATE TABLE "order_items" (
  "id"                 TEXT NOT NULL,
  "orderId"            TEXT NOT NULL,
  "listingId"          TEXT NOT NULL,
  "titleSnapshot"      TEXT NOT NULL,
  "priceCentsSnapshot" INTEGER NOT NULL,
  "photoUrlSnapshot"   TEXT,
  "quantity"           INTEGER NOT NULL,
  "options"            JSONB,
  CONSTRAINT "order_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_items_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "order_items_listingId_fkey"
    FOREIGN KEY ("listingId") REFERENCES "listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "order_items_orderId_idx" ON "order_items"("orderId");
