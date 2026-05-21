import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';

import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Idempotent } from '@common/decorators/idempotent.decorator';
import type { AuthenticatedUser } from '@common/types/authenticated-request.type';

import { PaymentResponseDto } from './dto/payment-response.dto';
import { ConfirmPaymentDto, CreatePaymentDto } from './dto/payment.dto';
import { PaymentsService } from './payments.service';

@Controller({ path: '', version: '1' })
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /**
   * Initiate payment for an existing order. The response includes a
   * provider-specific `clientPayload` the Flutter app uses to complete the
   * flow (Stripe clientSecret, PayPal approveUrl, Pawapay depositId).
   *
   * Idempotency-Key required — a retry won't duplicate the upstream intent.
   */
  @Idempotent()
  @Post('orders/:id/payment')
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') orderId: string,
    @Body() dto: CreatePaymentDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<PaymentResponseDto> {
    return this.payments.createForOrder(actor.id, orderId, {
      provider: dto.provider,
      returnUrl: dto.returnUrl,
      cancelUrl: dto.cancelUrl,
      phone: dto.phone,
      operator: dto.operator,
      idempotencyKey,
    });
  }

  @Get('payments/:id')
  get(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<PaymentResponseDto> {
    return this.payments.getById(actor.id, id);
  }

  /**
   * Client-driven capture. Only PayPal currently uses this — Stripe and
   * Pawapay drive state through webhooks alone.
   */
  @Post('payments/:id/confirm')
  @HttpCode(HttpStatus.OK)
  confirm(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ConfirmPaymentDto,
  ): Promise<PaymentResponseDto> {
    return this.payments.confirm(actor.id, id, dto.providerRef);
  }
}
