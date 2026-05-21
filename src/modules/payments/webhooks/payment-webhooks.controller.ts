import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { PaymentProviderKind } from '@prisma/client';

import { Public } from '@common/decorators/public.decorator';

import { PaymentsService } from '../payments.service';
import { PaymentProviderRegistry } from '../providers/payment-provider.registry';

import type { Request } from 'express';

interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

/**
 * Public endpoints that receive provider webhooks. Each requires the
 * provider's signature header to be valid; we never trust the body alone.
 *
 * The main.ts bootstrap enables `rawBody: true` so we can verify signatures
 * against the exact bytes the provider signed.
 */
@Controller({ path: 'internal', version: '1' })
export class PaymentWebhooksController {
  private readonly logger = new Logger(PaymentWebhooksController.name);

  constructor(
    private readonly payments: PaymentsService,
    private readonly registry: PaymentProviderRegistry,
  ) {}

  @Public()
  @Post('stripe/webhook')
  @HttpCode(HttpStatus.NO_CONTENT)
  async stripe(@Req() req: RawBodyRequest): Promise<void> {
    await this.dispatch(PaymentProviderKind.STRIPE, req);
  }

  @Public()
  @Post('paypal/webhook')
  @HttpCode(HttpStatus.NO_CONTENT)
  async paypal(@Req() req: RawBodyRequest): Promise<void> {
    await this.dispatch(PaymentProviderKind.PAYPAL, req);
  }

  @Public()
  @Post('pawapay/webhook')
  @HttpCode(HttpStatus.NO_CONTENT)
  async pawapay(@Req() req: RawBodyRequest): Promise<void> {
    await this.dispatch(PaymentProviderKind.PAWAPAY, req);
  }

  private async dispatch(kind: PaymentProviderKind, req: RawBodyRequest): Promise<void> {
    if (!req.rawBody || req.rawBody.length === 0) {
      throw new BadRequestException('Missing webhook body');
    }
    const handler = this.registry.forWebhook(kind);
    // Cast Express's `headers` (IncomingHttpHeaders) to the shape providers expect.
    const event = await handler.verifyAndParseWebhook(
      req.rawBody,
      req.headers as Record<string, string | string[] | undefined>,
    );
    if (event.outcome === 'ignored') {
      this.logger.debug(`Ignored ${kind} webhook event for ${event.providerRef}`);
      return;
    }
    await this.payments.applyWebhookEvent(kind, event);
  }
}
