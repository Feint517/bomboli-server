import { createHmac, timingSafeEqual } from 'crypto';

import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { PaymentProviderKind } from '@prisma/client';
import { ulid } from 'ulid';

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

const VALID_OPERATORS = new Set(['VODACOM_MPESA_COD', 'ORANGE_COD', 'AIRTEL_OAPI_COD']);

/**
 * Pawapay aggregator for Mobile Money — covers Vodacom M-Pesa, Orange Money,
 * and Airtel Money in DRC under a single API. Initiates a USSD-push deposit;
 * the user enters their PIN on their phone; Pawapay fires a webhook with
 * the final status.
 */
@Injectable()
export class PawapayPaymentProvider implements PaymentProviderHandler {
  readonly kind = PaymentProviderKind.PAWAPAY;
  private readonly logger = new Logger(PawapayPaymentProvider.name);

  constructor(
    @Inject(paymentsConfig.KEY) private readonly cfg: ConfigType<typeof paymentsConfig>,
  ) {}

  isConfigured(): boolean {
    return this.cfg.pawapay.enabled;
  }

  async createIntent(args: CreateIntentArgs): Promise<CreateIntentResult> {
    if (!this.cfg.pawapay.enabled) {
      throw notConfigured('Pawapay');
    }
    if (!args.pawapayPhone || !args.pawapayOperator) {
      throw new DomainException(
        ErrorCodes.ValidationFailed,
        'Pawapay payment requires phone and operator.',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!VALID_OPERATORS.has(args.pawapayOperator)) {
      throw new DomainException(
        ErrorCodes.ValidationFailed,
        `Unsupported Pawapay operator: ${args.pawapayOperator}.`,
        HttpStatus.BAD_REQUEST,
      );
    }
    const depositId = ulid();
    const res = await fetch(`${this.cfg.pawapay.apiBase}/deposits`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.cfg.pawapay.apiKey}`,
        'Content-Type': 'application/json',
        ...(args.idempotencyKey ? { 'Idempotency-Key': args.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        depositId,
        amount: formatMajor(args.amountCents, args.currency),
        currency: args.currency,
        country: 'COD', // DRC ISO 3166-1 alpha-3
        correspondent: args.pawapayOperator,
        payer: {
          type: 'MSISDN',
          address: { value: args.pawapayPhone.replace(/^\+/, '') },
        },
        customerTimestamp: new Date().toISOString(),
        statementDescription: `Bomboli ${args.orderId.slice(0, 12)}`,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      this.logger.warn(`Pawapay deposit failed: ${res.status} ${text}`);
      throw new DomainException(
        ErrorCodes.AuthProviderError,
        'Mobile Money initiation failed. Please try again.',
        HttpStatus.BAD_GATEWAY,
      );
    }
    const body = (await res.json()) as { depositId: string; status: string };
    return {
      providerRef: body.depositId,
      clientPayload: {
        depositId: body.depositId,
        status: body.status,
        message: 'Vérifiez votre téléphone et entrez votre code PIN pour confirmer le paiement.',
      },
      rawResponse: body,
    };
  }

  async verifyAndParseWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<WebhookEvent> {
    if (!this.cfg.pawapay.webhookSecret) {
      throw notConfigured('Pawapay webhook');
    }
    const provided = pickHeader(headers, 'x-pawapay-signature');
    if (!provided) {
      throw signatureMissing('X-Pawapay-Signature');
    }
    const computed = createHmac('sha256', this.cfg.pawapay.webhookSecret)
      .update(rawBody)
      .digest('hex');
    const ok =
      provided.length === computed.length &&
      timingSafeEqual(Buffer.from(provided), Buffer.from(computed));
    if (!ok) {
      throw signatureInvalid('Pawapay');
    }
    const event = JSON.parse(rawBody.toString('utf-8')) as PawapayWebhookEvent;
    return this.translateEvent(event);
  }

  async refund(providerRef: string): Promise<RefundResult> {
    if (!this.cfg.pawapay.enabled) {
      throw notConfigured('Pawapay');
    }
    const refundId = ulid();
    const res = await fetch(`${this.cfg.pawapay.apiBase}/refunds`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.cfg.pawapay.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refundId, depositId: providerRef }),
    });
    if (!res.ok) {
      throw new DomainException(
        ErrorCodes.AuthProviderError,
        `Pawapay refund failed: ${res.status}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
    return { rawResponse: (await res.json()) as Record<string, unknown> };
  }

  private translateEvent(event: PawapayWebhookEvent): WebhookEvent {
    const providerRef = event.depositId ?? event.refundId ?? '';
    let outcome: WebhookOutcome = 'ignored';
    let failureReason: string | undefined;
    switch (event.status) {
      case 'COMPLETED':
        outcome = event.kind === 'REFUND' ? 'refunded' : 'succeeded';
        break;
      case 'FAILED':
        outcome = 'failed';
        failureReason = event.failureReason?.failureMessage ?? event.failureReason?.failureCode;
        break;
      case 'REJECTED':
        outcome = 'cancelled';
        break;
    }
    return {
      providerRef,
      outcome,
      failureReason,
      rawPayload: { id: providerRef, status: event.status, kind: event.kind },
    };
  }
}

interface PawapayWebhookEvent {
  depositId?: string;
  refundId?: string;
  kind?: 'DEPOSIT' | 'REFUND';
  status: 'COMPLETED' | 'FAILED' | 'REJECTED' | string;
  failureReason?: { failureCode?: string; failureMessage?: string };
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

function formatMajor(amountCents: number, currency: string): string {
  const digits = currency === 'CDF' ? 0 : 2;
  return (amountCents / 10 ** digits).toFixed(digits);
}
