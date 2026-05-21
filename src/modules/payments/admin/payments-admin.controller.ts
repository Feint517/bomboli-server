import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';

import { Audited } from '@common/decorators/audited.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { UserRole } from '@common/enums/user-role.enum';
import type { AuthenticatedUser } from '@common/types/authenticated-request.type';

import { PaymentResponseDto } from '../dto/payment-response.dto';
import { ManualConfirmPaymentDto, RefundPaymentDto } from '../dto/payment.dto';
import { PaymentsService } from '../payments.service';

/**
 * Admin-only payment operations. Both endpoints are audit-logged via the
 * @Audited() decorator. The RolesGuard (global) enforces `ADMIN`.
 */
@Roles(UserRole.Admin)
@Controller({ path: 'admin/payments', version: '1' })
export class PaymentsAdminController {
  constructor(private readonly payments: PaymentsService) {}

  /**
   * Mark a MANUAL payment as SUCCEEDED. Used for cash-on-delivery and
   * out-of-band Mobile Money payments where the buyer paid the seller
   * directly and the admin records the receipt.
   */
  @Audited({ action: 'payment.manual_confirm', resourceType: 'Payment' })
  @Post('manual-confirm')
  @HttpCode(HttpStatus.OK)
  manualConfirm(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: ManualConfirmPaymentDto,
  ): Promise<PaymentResponseDto> {
    return this.payments.manualConfirm(actor.id, dto.paymentId, dto.externalRef);
  }

  /**
   * Issue a refund. Routes to the original provider — Stripe/PayPal/Pawapay
   * call the provider's refund API; Manual just flips bookkeeping.
   */
  @Audited({
    action: 'payment.refund',
    resourceType: 'Payment',
    resourceIdFrom: 'params.id',
  })
  @Post(':id/refund')
  @HttpCode(HttpStatus.OK)
  refund(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') paymentId: string,
    @Body() dto: RefundPaymentDto,
  ): Promise<PaymentResponseDto> {
    return this.payments.refund(actor.id, paymentId, dto.amountCents);
  }
}
