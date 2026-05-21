import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { PaymentProviderKind } from '@prisma/client';

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

/**
 * PayPal REST API v2. Orders are created server-side; the client redirects
 * to PayPal's approval URL, returns to the app, and the API captures the
 * approved order. Webhooks confirm both capture-completed and capture-denied.
 *
 * The PayPal Node SDK is officially deprecated, so we call REST directly
 * via fetch.
 */
@Injectable()
export class PayPalPaymentProvider implements PaymentProviderHandler {
  readonly kind = PaymentProviderKind.PAYPAL;
  private readonly logger = new Logger(PayPalPaymentProvider.name);
  private cachedToken: { value: string; expiresAt: number } | null = null;

  constructor(
    @Inject(paymentsConfig.KEY) private readonly cfg: ConfigType<typeof paymentsConfig>,
  ) {}

  isConfigured(): boolean {
    return this.cfg.paypal.enabled;
  }

  private async getAccessToken(): Promise<string> {
    if (!this.cfg.paypal.enabled) {
      throw notConfigured('PayPal');
    }
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now() + 60_000) {
      return this.cachedToken.value;
    }
    const basic = Buffer.from(
      `${this.cfg.paypal.clientId}:${this.cfg.paypal.clientSecret}`,
    ).toString('base64');
    const res = await fetch(`${this.cfg.paypal.apiBase}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) {
      throw new DomainException(
        ErrorCodes.AuthProviderError,
        `PayPal auth failed: ${res.status}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.cachedToken = {
      value: body.access_token,
      expiresAt: Date.now() + body.expires_in * 1000,
    };
    return body.access_token;
  }

  async createIntent(args: CreateIntentArgs): Promise<CreateIntentResult> {
    if (!args.paypalReturnUrl || !args.paypalCancelUrl) {
      throw new DomainException(
        ErrorCodes.ValidationFailed,
        'PayPal payment requires returnUrl and cancelUrl.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const token = await this.getAccessToken();
    const res = await fetch(`${this.cfg.paypal.apiBase}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(args.idempotencyKey ? { 'PayPal-Request-Id': args.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: args.paymentId,
            amount: {
              currency_code: args.currency,
              value: formatMajor(args.amountCents, args.currency),
            },
          },
        ],
        application_context: {
          return_url: args.paypalReturnUrl,
          cancel_url: args.paypalCancelUrl,
          shipping_preference: 'NO_SHIPPING',
        },
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      this.logger.warn(`PayPal createOrder failed: ${res.status} ${text}`);
      throw new DomainException(
        ErrorCodes.AuthProviderError,
        'PayPal order creation failed.',
        HttpStatus.BAD_GATEWAY,
      );
    }
    const body = (await res.json()) as PayPalOrderResponse;
    const approveLink = body.links?.find((l) => l.rel === 'approve')?.href;
    if (!approveLink) {
      throw new DomainException(
        ErrorCodes.AuthProviderError,
        'PayPal did not return an approval link.',
        HttpStatus.BAD_GATEWAY,
      );
    }
    return {
      providerRef: body.id,
      clientPayload: { approveUrl: approveLink, orderId: body.id },
      rawResponse: { id: body.id, status: body.status },
    };
  }

  /**
   * Confirms an approved PayPal order by capturing it. Called from
   * `PaymentsService.confirm` for PayPal-flavored payments.
   */
  async captureOrder(providerRef: string): Promise<{ status: string; raw: unknown }> {
    const token = await this.getAccessToken();
    const res = await fetch(
      `${this.cfg.paypal.apiBase}/v2/checkout/orders/${providerRef}/capture`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new DomainException(
        ErrorCodes.AuthProviderError,
        `PayPal capture failed: ${res.status} ${text}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
    const body = (await res.json()) as { status: string };
    return { status: body.status, raw: body };
  }

  async verifyAndParseWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<WebhookEvent> {
    if (!this.cfg.paypal.webhookId) {
      throw notConfigured('PayPal webhook');
    }
    const transmissionId = pickHeader(headers, 'paypal-transmission-id');
    const transmissionTime = pickHeader(headers, 'paypal-transmission-time');
    const certUrl = pickHeader(headers, 'paypal-cert-url');
    const authAlgo = pickHeader(headers, 'paypal-auth-algo');
    const transmissionSig = pickHeader(headers, 'paypal-transmission-sig');
    if (!transmissionId || !transmissionTime || !certUrl || !authAlgo || !transmissionSig) {
      throw signatureMissing('PayPal-Transmission-*');
    }

    const token = await this.getAccessToken();
    const verify = await fetch(
      `${this.cfg.paypal.apiBase}/v1/notifications/verify-webhook-signature`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth_algo: authAlgo,
          cert_url: certUrl,
          transmission_id: transmissionId,
          transmission_sig: transmissionSig,
          transmission_time: transmissionTime,
          webhook_id: this.cfg.paypal.webhookId,
          webhook_event: JSON.parse(rawBody.toString('utf-8')),
        }),
      },
    );
    const verifyBody = (await verify.json()) as { verification_status: string };
    if (verifyBody.verification_status !== 'SUCCESS') {
      throw signatureInvalid('PayPal');
    }

    const event = JSON.parse(rawBody.toString('utf-8')) as PayPalWebhookEvent;
    return this.translateEvent(event);
  }

  async refund(providerRef: string, amountCents?: number): Promise<RefundResult> {
    // PayPal refunds happen against capture IDs, not order IDs. The capture
    // id is stored in payment.metadata.captureId when capture succeeds.
    // For pilot, the providerRef param IS the capture id (set during confirm).
    const token = await this.getAccessToken();
    const body: Record<string, unknown> = {};
    if (amountCents !== undefined) {
      // We don't have the currency here; assume the original capture's currency
      // is set elsewhere. For simplicity require explicit refund-all only.
      throw new DomainException(
        ErrorCodes.ValidationFailed,
        'Partial PayPal refunds are not supported yet.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const res = await fetch(
      `${this.cfg.paypal.apiBase}/v2/payments/captures/${providerRef}/refund`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new DomainException(
        ErrorCodes.AuthProviderError,
        `PayPal refund failed: ${res.status} ${text}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
    return { rawResponse: (await res.json()) as Record<string, unknown> };
  }

  private translateEvent(event: PayPalWebhookEvent): WebhookEvent {
    const providerRef =
      event.resource?.supplementary_data?.related_ids?.order_id ?? event.resource?.id ?? '';
    let outcome: WebhookOutcome = 'ignored';
    switch (event.event_type) {
      case 'PAYMENT.CAPTURE.COMPLETED':
        outcome = 'succeeded';
        break;
      case 'PAYMENT.CAPTURE.DENIED':
      case 'PAYMENT.CAPTURE.DECLINED':
        outcome = 'failed';
        break;
      case 'CHECKOUT.ORDER.VOIDED':
      case 'PAYMENT.CAPTURE.REVERSED':
        outcome = 'cancelled';
        break;
      case 'PAYMENT.CAPTURE.REFUNDED':
        outcome = 'refunded';
        break;
    }
    return {
      providerRef,
      outcome,
      rawPayload: { id: event.id, eventType: event.event_type, providerRef },
    };
  }
}

interface PayPalOrderResponse {
  id: string;
  status: string;
  links?: { rel: string; href: string }[];
}

interface PayPalWebhookEvent {
  id: string;
  event_type: string;
  resource?: {
    id?: string;
    supplementary_data?: { related_ids?: { order_id?: string } };
  };
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
    `Missing webhook headers: ${headerName}.`,
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
