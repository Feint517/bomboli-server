import { HttpStatus, Injectable } from '@nestjs/common';
import { PaymentProviderKind } from '@prisma/client';

import { ErrorCodes } from '@common/constants/error-codes.constants';
import { DomainException } from '@common/exceptions/domain.exception';

import {
  CreateIntentArgs,
  CreateIntentResult,
  PaymentProviderHandler,
  RefundResult,
  WebhookEvent,
} from './payment-provider.interface';

/**
 * In-band cash-on-delivery / outside-the-app payment path. The buyer pays
 * the seller directly (USSD outside the app, cash on pickup, etc.) and an
 * admin marks the payment as SUCCEEDED via the admin endpoint.
 *
 * This provider is always configured — no external dependencies.
 */
@Injectable()
export class ManualPaymentProvider implements PaymentProviderHandler {
  readonly kind = PaymentProviderKind.MANUAL;

  isConfigured(): boolean {
    return true;
  }

  createIntent(args: CreateIntentArgs): Promise<CreateIntentResult> {
    // No upstream call. Returns a synthetic ref so the audit trail stays
    // consistent with the other providers.
    return Promise.resolve({
      providerRef: `manual-${args.paymentId}`,
      clientPayload: {
        message:
          'Paiement à effectuer hors plateforme. Un administrateur confirmera votre commande.',
      },
      rawResponse: { provider: 'manual', noop: true },
    });
  }

  verifyAndParseWebhook(): Promise<WebhookEvent> {
    throw new DomainException(
      ErrorCodes.Forbidden,
      'Manual payments have no webhook surface.',
      HttpStatus.FORBIDDEN,
    );
  }

  refund(): Promise<RefundResult> {
    // No external call. The admin endpoint records the refund decision; the
    // physical refund happens out-of-band.
    return Promise.resolve({ rawResponse: { provider: 'manual', refunded: true } });
  }
}
