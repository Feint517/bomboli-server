import { PaymentProviderKind } from '@prisma/client';

export interface CreateIntentArgs {
  paymentId: string;
  orderId: string;
  amountCents: number;
  currency: string;
  buyerEmail: string;
  buyerPhone?: string | null;
  /** Idempotency key from the request header — forwarded to the provider when supported. */
  idempotencyKey?: string;

  // Provider-specific extras (only consumed by the matching provider).
  paypalReturnUrl?: string;
  paypalCancelUrl?: string;
  pawapayPhone?: string;
  pawapayOperator?: string;
}

export interface CreateIntentResult {
  /** Provider-side identifier (Stripe PaymentIntent id, PayPal order id, etc.). */
  providerRef: string;
  /** Payload returned to the client; provider-specific shape. */
  clientPayload: Record<string, unknown>;
  /** Sanitized provider response for the attempt log. */
  rawResponse: Record<string, unknown>;
}

export type WebhookOutcome = 'succeeded' | 'failed' | 'cancelled' | 'refunded' | 'ignored';

export interface WebhookEvent {
  providerRef: string;
  outcome: WebhookOutcome;
  /** Optional human-readable failure reason for FAILED outcomes. */
  failureReason?: string;
  /** Sanitized provider payload for the attempt log. */
  rawPayload: Record<string, unknown>;
}

export interface RefundResult {
  rawResponse: Record<string, unknown>;
}

/**
 * Provider-agnostic interface. Each implementation isolates one upstream
 * payment service (Stripe, PayPal, Pawapay) or the in-band Manual path.
 *
 * Providers must never throw on injection — only on actual usage when not
 * configured. This lets the API boot cleanly with any subset of providers
 * enabled.
 */
export interface PaymentProviderHandler {
  readonly kind: PaymentProviderKind;
  /** Returns true if the provider has all required environment variables set. */
  isConfigured(): boolean;
  createIntent(args: CreateIntentArgs): Promise<CreateIntentResult>;
  /**
   * Verify the provider's webhook signature and extract the canonical
   * `WebhookEvent`. Throw on signature mismatch.
   */
  verifyAndParseWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<WebhookEvent>;
  refund(providerRef: string, amountCents?: number): Promise<RefundResult>;
}
