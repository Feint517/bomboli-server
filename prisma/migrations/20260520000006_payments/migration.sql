-- Enums
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUNDED');
CREATE TYPE "PaymentProviderKind" AS ENUM ('STRIPE', 'PAYPAL', 'PAWAPAY', 'MANUAL');

-- Payment
CREATE TABLE "payments" (
  "id"            TEXT NOT NULL,
  "orderId"       TEXT NOT NULL,
  "provider"      "PaymentProviderKind" NOT NULL,
  "providerRef"   TEXT,
  "amountCents"   INTEGER NOT NULL,
  "currency"      TEXT NOT NULL,
  "status"        "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  "capturedAt"    TIMESTAMP(3),
  "failureReason" TEXT,
  "metadata"      JSONB,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payments_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "payments_orderId_key" ON "payments"("orderId");
CREATE INDEX "payments_status_createdAt_idx" ON "payments"("status", "createdAt");
CREATE INDEX "payments_provider_providerRef_idx" ON "payments"("provider", "providerRef");

-- PaymentAttempt
CREATE TABLE "payment_attempts" (
  "id"             TEXT NOT NULL,
  "paymentId"      TEXT NOT NULL,
  "kind"           TEXT NOT NULL,
  "idempotencyKey" TEXT,
  "provider"       "PaymentProviderKind" NOT NULL,
  "request"        JSONB,
  "response"       JSONB,
  "status"         "PaymentStatus" NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_attempts_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "payment_attempts_paymentId_createdAt_idx" ON "payment_attempts"("paymentId", "createdAt");
