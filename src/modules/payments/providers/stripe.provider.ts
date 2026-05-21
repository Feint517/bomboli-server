import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { PaymentProviderKind } from '@prisma/client';
import StripeCtor from 'stripe';

import { ErrorCodes } from '@common/constants/error-codes.constants';
import { DomainException } from '@common/exceptions/domain.exception';

import { paymentsConfig } from '@config/payments.config';

import {
  CreateIntentArgs,
  CreateIntentResult,
  PaymentProviderHandler,
  RefundResult,
  WebhookEvent,
  WebhookOutcome,
} from './payment-provider.interface';

type StripeClient = ReturnType<typeof StripeCtor>;

@Injectable()
export class StripePaymentProvider implements PaymentProviderHandler {
  readonly kind = PaymentProviderKind.STRIPE;
  private readonly logger = new Logger(StripePaymentProvider.name);
  private stripeClient: StripeClient | null = null;

  constructor(
    @Inject(paymentsConfig.KEY) private readonly cfg: ConfigType<typeof paymentsConfig>,
  ) {}

  isConfigured(): boolean {
    return this.cfg.stripe.enabled;
  }

  /** Throws if no API key is configured — used for outbound calls. */
  private apiClient(): StripeClient {
    if (!this.cfg.stripe.secretKey) {
      throw notConfigured('Stripe');
    }
    return this.getOrCreateClient(this.cfg.stripe.secretKey);
  }

  /**
   * Webhook verification only needs an instance to call
   * `webhooks.constructEvent`; the constructor's secret-key arg is never
   * used during verification (only the webhook secret matters). Allows
   * webhooks to function before the API key is provisioned.
   */
  private webhookClient(): StripeClient {
    return this.getOrCreateClient(
      this.cfg.stripe.secretKey || 'sk_test_placeholder_for_webhook_only',
    );
  }

  private getOrCreateClient(secret: string): StripeClient {
    if (!this.stripeClient) {
      this.stripeClient = new StripeCtor(secret);
    }
    return this.stripeClient;
  }

  async createIntent(args: CreateIntentArgs): Promise<CreateIntentResult> {
    const intent = await this.apiClient().paymentIntents.create(
      {
        amount: args.amountCents,
        currency: args.currency.toLowerCase(),
        metadata: {
          paymentId: args.paymentId,
          orderId: args.orderId,
        },
        receipt_email: args.buyerEmail,
        automatic_payment_methods: { enabled: true },
      },
      args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : undefined,
    );
    return {
      providerRef: intent.id,
      clientPayload: {
        clientSecret: intent.client_secret,
        publishableKey: this.cfg.stripe.publishableKey,
      },
      rawResponse: { id: intent.id, status: intent.status, amount: intent.amount },
    };
  }

  async verifyAndParseWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<WebhookEvent> {
    if (!this.cfg.stripe.webhookSecret) {
      throw notConfigured('Stripe webhook');
    }
    const signature = pickHeader(headers, 'stripe-signature');
    if (!signature) {
      throw signatureMissing('Stripe-Signature');
    }
    let event: Awaited<ReturnType<StripeClient['webhooks']['constructEventAsync']>>;
    try {
      event = await this.webhookClient().webhooks.constructEventAsync(
        rawBody,
        signature,
        this.cfg.stripe.webhookSecret,
      );
    } catch (err) {
      this.logger.warn(`Stripe webhook signature failed: ${(err as Error).message}`);
      throw signatureInvalid('Stripe');
    }
    return this.translateEvent({
      id: event.id,
      type: event.type as string,
      data: { object: event.data.object as unknown as Record<string, unknown> },
    });
  }

  async refund(providerRef: string, amountCents?: number): Promise<RefundResult> {
    const refund = await this.apiClient().refunds.create({
      payment_intent: providerRef,
      ...(amountCents !== undefined ? { amount: amountCents } : {}),
    });
    return { rawResponse: { id: refund.id, status: refund.status, amount: refund.amount } };
  }

  private translateEvent(event: {
    id: string;
    type: string;
    data: { object: Record<string, unknown> };
  }): WebhookEvent {
    const data = event.data.object;
    const providerRef =
      typeof data.payment_intent === 'string'
        ? data.payment_intent
        : ((data.id as string | undefined) ?? '');
    let outcome: WebhookOutcome = 'ignored';
    let failureReason: string | undefined;
    switch (event.type) {
      case 'payment_intent.succeeded':
        outcome = 'succeeded';
        break;
      case 'payment_intent.payment_failed':
      case 'payment_intent.canceled':
        outcome = event.type === 'payment_intent.canceled' ? 'cancelled' : 'failed';
        failureReason =
          (data.last_payment_error as { message?: string } | undefined)?.message ?? undefined;
        break;
      case 'charge.refunded':
        outcome = 'refunded';
        break;
      default:
        outcome = 'ignored';
    }
    return {
      providerRef,
      outcome,
      failureReason,
      rawPayload: { id: event.id, type: event.type, providerRef },
    };
  }
}

function notConfigured(name: string): DomainException {
  return new DomainException(
    ErrorCodes.AuthProviderError,
    `${name} is not configured on this server.`,
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}

function signatureMissing(headerName: string): DomainException {
  return new DomainException(
    ErrorCodes.Unauthorized,
    `Missing webhook signature header: ${headerName}.`,
    HttpStatus.UNAUTHORIZED,
  );
}

function signatureInvalid(provider: string): DomainException {
  return new DomainException(
    ErrorCodes.Unauthorized,
    `Invalid ${provider} webhook signature.`,
    HttpStatus.UNAUTHORIZED,
  );
}

function pickHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const v = headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}
