import { PaymentProviderKind } from '@prisma/client';

export const PaymentEvents = {
  Created: 'payment.created',
  Succeeded: 'payment.succeeded',
  Failed: 'payment.failed',
  Cancelled: 'payment.cancelled',
  Refunded: 'payment.refunded',
} as const;

export type PaymentEvent = (typeof PaymentEvents)[keyof typeof PaymentEvents];

export interface PaymentEventPayload {
  paymentId: string;
  orderId: string;
  provider: PaymentProviderKind;
  amountCents: number;
  currency: string;
  at: Date;
  failureReason?: string | null;
}
