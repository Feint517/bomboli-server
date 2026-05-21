import { HttpStatus, Injectable } from '@nestjs/common';
import { PaymentProviderKind } from '@prisma/client';

import { ErrorCodes } from '@common/constants/error-codes.constants';
import { DomainException } from '@common/exceptions/domain.exception';

import { ManualPaymentProvider } from './manual.provider';
import { PawapayPaymentProvider } from './pawapay.provider';
import { PaymentProviderHandler } from './payment-provider.interface';
import { PayPalPaymentProvider } from './paypal.provider';
import { StripePaymentProvider } from './stripe.provider';

/**
 * Routes to the right provider implementation by kind. Throws a clean 503
 * when the chosen provider isn't configured (rather than crashing on a
 * missing API key downstream).
 */
@Injectable()
export class PaymentProviderRegistry {
  private readonly byKind: Record<PaymentProviderKind, PaymentProviderHandler>;

  constructor(
    manual: ManualPaymentProvider,
    stripe: StripePaymentProvider,
    paypal: PayPalPaymentProvider,
    pawapay: PawapayPaymentProvider,
  ) {
    this.byKind = {
      MANUAL: manual,
      STRIPE: stripe,
      PAYPAL: paypal,
      PAWAPAY: pawapay,
    };
  }

  /** Returns the handler for the given kind. Throws 503 if not configured. */
  for(kind: PaymentProviderKind): PaymentProviderHandler {
    const provider = this.byKind[kind];
    if (!provider.isConfigured()) {
      throw new DomainException(
        ErrorCodes.AuthProviderError,
        `Payment provider ${kind} is not configured on this server.`,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return provider;
  }

  /** Like `for`, but for webhook routing (skips the isConfigured check —
   *  webhooks may need to verify even on disabled providers to reject them). */
  forWebhook(kind: PaymentProviderKind): PaymentProviderHandler {
    return this.byKind[kind];
  }

  /** Returns the configured-providers list (useful for the /v1/payments/providers discovery endpoint, if we add one). */
  enabledKinds(): PaymentProviderKind[] {
    return (Object.entries(this.byKind) as [PaymentProviderKind, PaymentProviderHandler][])
      .filter(([, p]) => p.isConfigured())
      .map(([k]) => k);
  }
}
