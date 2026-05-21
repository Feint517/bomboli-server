export interface PaymentResponseDto {
  id: string;
  orderId: string;
  provider: 'STRIPE' | 'PAYPAL' | 'PAWAPAY' | 'MANUAL';
  providerRef: string | null;
  amountCents: number;
  currency: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'REFUNDED';
  capturedAt: string | null;
  failureReason: string | null;
  /** Provider-specific payload the client uses to complete payment. */
  clientPayload: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}
