import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { paymentsConfig } from '@config/payments.config';

import { PaymentsAdminController } from './admin/payments-admin.controller';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { ManualPaymentProvider } from './providers/manual.provider';
import { PawapayPaymentProvider } from './providers/pawapay.provider';
import { PaymentProviderRegistry } from './providers/payment-provider.registry';
import { PayPalPaymentProvider } from './providers/paypal.provider';
import { StripePaymentProvider } from './providers/stripe.provider';
import { PaymentWebhooksController } from './webhooks/payment-webhooks.controller';

@Module({
  imports: [ConfigModule.forFeature(paymentsConfig)],
  controllers: [PaymentsController, PaymentWebhooksController, PaymentsAdminController],
  providers: [
    PaymentsService,
    PaymentProviderRegistry,
    ManualPaymentProvider,
    StripePaymentProvider,
    PayPalPaymentProvider,
    PawapayPaymentProvider,
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
