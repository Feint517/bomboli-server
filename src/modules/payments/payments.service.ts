import {
  ForbiddenException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Payment, PaymentProviderKind, PaymentStatus, Prisma } from '@prisma/client';

import { ErrorCodes } from '@common/constants/error-codes.constants';
import { DomainException } from '@common/exceptions/domain.exception';

import { PrismaService } from '@infrastructure/database/prisma.service';

import { UsersService } from '@modules/users/users.service';

import { PaymentResponseDto } from './dto/payment-response.dto';
import { PaymentEventPayload, PaymentEvents } from './payments.events';
import { WebhookEvent } from './providers/payment-provider.interface';
import { PaymentProviderRegistry } from './providers/payment-provider.registry';

import type { PayPalPaymentProvider } from './providers/paypal.provider';

interface CreatePaymentInput {
  provider: PaymentProviderKind;
  returnUrl?: string;
  cancelUrl?: string;
  phone?: string;
  operator?: string;
  idempotencyKey?: string;
}

/**
 * Valid forward transitions for Payment.status. Cancelled and Refunded are
 * terminal. Failed can be retried only by creating a new Payment (rejected
 * here — buyer must start a new order).
 */
const ALLOWED_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  PENDING: ['SUCCEEDED', 'FAILED', 'CANCELLED'],
  SUCCEEDED: ['REFUNDED'],
  FAILED: [],
  CANCELLED: [],
  REFUNDED: [],
};

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly registry: PaymentProviderRegistry,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Initiate a payment for the given order. Only the order's buyer may call
   * this. One payment per order — repeated calls return the existing
   * payment if PENDING, or 409 if it's already in a terminal state.
   */
  async createForOrder(
    actorSupabaseId: string,
    orderId: string,
    input: CreatePaymentInput,
  ): Promise<PaymentResponseDto> {
    const buyer = await this.users.getBySupabaseIdOrFail(actorSupabaseId);
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { payment: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.buyerId !== buyer.id) throw new ForbiddenException('Not your order');
    if (order.status === 'CANCELLED' || order.status === 'REFUNDED') {
      throw new DomainException(
        ErrorCodes.Conflict,
        `Cannot pay for an order with status ${order.status}.`,
        HttpStatus.CONFLICT,
      );
    }

    if (order.payment) {
      if (order.payment.status === 'PENDING') {
        // Idempotent re-issue — return the existing payment without calling
        // the provider again.
        return this.compose(order.payment);
      }
      throw new DomainException(
        ErrorCodes.Conflict,
        `Order already has a payment in status ${order.payment.status}.`,
        HttpStatus.CONFLICT,
      );
    }

    const provider = this.registry.for(input.provider);

    // Create the Payment row first so we have an id to pass to the provider.
    const payment = await this.prisma.payment.create({
      data: {
        orderId: order.id,
        provider: input.provider,
        amountCents: order.totalCents,
        currency: order.currency,
        status: PaymentStatus.PENDING,
      },
    });

    let providerRef: string | null = null;
    let clientPayload: Record<string, unknown> | null = null;
    let attemptStatus: PaymentStatus = PaymentStatus.PENDING;
    let attemptError: unknown = null;

    try {
      const result = await provider.createIntent({
        paymentId: payment.id,
        orderId: order.id,
        amountCents: order.totalCents,
        currency: order.currency,
        buyerEmail: buyer.email,
        buyerPhone: buyer.phone,
        idempotencyKey: input.idempotencyKey,
        paypalReturnUrl: input.returnUrl,
        paypalCancelUrl: input.cancelUrl,
        pawapayPhone: input.phone,
        pawapayOperator: input.operator,
      });
      providerRef = result.providerRef;
      clientPayload = result.clientPayload;

      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { providerRef, metadata: clientPayload as Prisma.InputJsonValue },
      });
      await this.logAttempt(
        payment.id,
        'createIntent',
        input.provider,
        input.idempotencyKey,
        {
          amountCents: order.totalCents,
          currency: order.currency,
        },
        result.rawResponse,
        PaymentStatus.PENDING,
      );
    } catch (err) {
      attemptError = err;
      attemptStatus = PaymentStatus.FAILED;
      await this.logAttempt(
        payment.id,
        'createIntent',
        input.provider,
        input.idempotencyKey,
        null,
        { error: (err as Error).message },
        attemptStatus,
      );
      // Mark the payment as FAILED so the order can be retried after the
      // buyer fixes the input (e.g. wrong phone).
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.FAILED, failureReason: (err as Error).message },
      });
      throw err;
    } finally {
      this.emit(PaymentEvents.Created, {
        paymentId: payment.id,
        orderId: order.id,
        provider: input.provider,
        amountCents: order.totalCents,
        currency: order.currency,
        at: new Date(),
        failureReason: attemptError ? (attemptError as Error).message : undefined,
      });
      void attemptStatus;
    }

    const refreshed = await this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    return this.compose(refreshed, clientPayload);
  }

  /**
   * Look up a payment by id. Accessible to the buyer or the seller of the
   * underlying order.
   */
  async getById(actorSupabaseId: string, paymentId: string): Promise<PaymentResponseDto> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { order: true },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    const buyer = await this.users.getBySupabaseIdOrFail(actorSupabaseId);
    const sellerSupabaseId = await this.lookupSellerSupabaseId(payment.order.sellerId);
    if (payment.order.buyerId !== buyer.id && sellerSupabaseId !== actorSupabaseId) {
      throw new ForbiddenException('Not your payment');
    }
    return this.compose(payment);
  }

  /**
   * Client-driven confirmation step. Most providers don't need this — the
   * webhook drives state. PayPal does: after the user approves the order,
   * the client returns to the app and calls this to capture funds.
   */
  async confirm(
    actorSupabaseId: string,
    paymentId: string,
    providerRefOverride?: string,
  ): Promise<PaymentResponseDto> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { order: true },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    const buyer = await this.users.getBySupabaseIdOrFail(actorSupabaseId);
    if (payment.order.buyerId !== buyer.id) throw new ForbiddenException('Not your payment');
    if (payment.status !== PaymentStatus.PENDING) {
      throw new DomainException(
        ErrorCodes.Conflict,
        `Payment is in status ${payment.status}; cannot confirm.`,
        HttpStatus.CONFLICT,
      );
    }
    const providerRef = providerRefOverride ?? payment.providerRef;
    if (!providerRef) {
      throw new DomainException(
        ErrorCodes.ValidationFailed,
        'No providerRef on file — pass it in the body.',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Only PayPal currently supports an explicit confirm/capture step.
    if (payment.provider !== PaymentProviderKind.PAYPAL) {
      throw new DomainException(
        ErrorCodes.Conflict,
        `Provider ${payment.provider} does not support explicit confirm — wait for the webhook.`,
        HttpStatus.CONFLICT,
      );
    }

    const paypal = this.registry.for(PaymentProviderKind.PAYPAL) as PayPalPaymentProvider;
    const captureResult = await paypal.captureOrder(providerRef);
    await this.logAttempt(
      payment.id,
      'capture',
      PaymentProviderKind.PAYPAL,
      undefined,
      { providerRef },
      captureResult.raw as Record<string, unknown>,
      captureResult.status === 'COMPLETED' ? PaymentStatus.SUCCEEDED : PaymentStatus.PENDING,
    );

    if (captureResult.status === 'COMPLETED') {
      return this.compose(await this.markSucceeded(payment.id, payment.providerRef ?? providerRef));
    }
    return this.compose(payment);
  }

  /**
   * Handle a parsed webhook event from any provider. Updates state, links
   * the order, and emits the corresponding domain event.
   */
  async applyWebhookEvent(provider: PaymentProviderKind, event: WebhookEvent): Promise<void> {
    const payment = await this.prisma.payment.findFirst({
      where: { provider, providerRef: event.providerRef },
    });
    if (!payment) {
      this.logger.warn(
        `Webhook for unknown payment: provider=${provider} ref=${event.providerRef}`,
      );
      return;
    }
    await this.logAttempt(
      payment.id,
      'webhook',
      provider,
      undefined,
      event.rawPayload,
      event.rawPayload,
      this.outcomeToStatus(event.outcome) ?? payment.status,
    );

    switch (event.outcome) {
      case 'succeeded':
        if (this.canTransition(payment.status, PaymentStatus.SUCCEEDED)) {
          await this.markSucceeded(payment.id, event.providerRef);
        }
        break;
      case 'failed':
        if (this.canTransition(payment.status, PaymentStatus.FAILED)) {
          await this.markFailed(payment.id, event.failureReason ?? 'Provider reported failure');
        }
        break;
      case 'cancelled':
        if (this.canTransition(payment.status, PaymentStatus.CANCELLED)) {
          await this.markCancelled(payment.id);
        }
        break;
      case 'refunded':
        if (this.canTransition(payment.status, PaymentStatus.REFUNDED)) {
          await this.markRefunded(payment.id);
        }
        break;
      case 'ignored':
      default:
        break;
    }
  }

  /**
   * Admin-only manual confirmation. For Manual provider only — marks the
   * payment as SUCCEEDED without any external integration.
   */
  async manualConfirm(
    _actorSupabaseId: string,
    paymentId: string,
    externalRef?: string,
  ): Promise<PaymentResponseDto> {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.provider !== PaymentProviderKind.MANUAL) {
      throw new DomainException(
        ErrorCodes.Conflict,
        'Only MANUAL payments can be confirmed via this endpoint.',
        HttpStatus.CONFLICT,
      );
    }
    if (!this.canTransition(payment.status, PaymentStatus.SUCCEEDED)) {
      throw new DomainException(
        ErrorCodes.Conflict,
        `Cannot manually confirm a ${payment.status} payment.`,
        HttpStatus.CONFLICT,
      );
    }
    await this.logAttempt(
      payment.id,
      'confirm',
      PaymentProviderKind.MANUAL,
      undefined,
      { externalRef },
      { externalRef, by: 'admin' },
      PaymentStatus.SUCCEEDED,
    );
    return this.compose(
      await this.markSucceeded(payment.id, externalRef ?? payment.providerRef ?? null),
    );
  }

  /**
   * Admin-only refund. Calls the provider then updates state. For Manual
   * payments, this is a bookkeeping flip with no external call.
   */
  async refund(
    _actorSupabaseId: string,
    paymentId: string,
    amountCents?: number,
  ): Promise<PaymentResponseDto> {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException('Payment not found');
    if (!this.canTransition(payment.status, PaymentStatus.REFUNDED)) {
      throw new DomainException(
        ErrorCodes.Conflict,
        `Cannot refund a ${payment.status} payment.`,
        HttpStatus.CONFLICT,
      );
    }
    const provider = this.registry.for(payment.provider);
    const result = await provider.refund(payment.providerRef ?? payment.id, amountCents);
    await this.logAttempt(
      payment.id,
      'refund',
      payment.provider,
      undefined,
      { amountCents },
      result.rawResponse,
      PaymentStatus.REFUNDED,
    );
    return this.compose(await this.markRefunded(payment.id));
  }

  // ----- State transitions (private) -----

  private canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
    if (from === to) return false;
    return ALLOWED_TRANSITIONS[from].includes(to);
  }

  private outcomeToStatus(outcome: WebhookEvent['outcome']): PaymentStatus | null {
    switch (outcome) {
      case 'succeeded':
        return PaymentStatus.SUCCEEDED;
      case 'failed':
        return PaymentStatus.FAILED;
      case 'cancelled':
        return PaymentStatus.CANCELLED;
      case 'refunded':
        return PaymentStatus.REFUNDED;
      default:
        return null;
    }
  }

  private async markSucceeded(paymentId: string, providerRef: string | null): Promise<Payment> {
    const updated = await this.prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: PaymentStatus.SUCCEEDED,
        capturedAt: new Date(),
        providerRef: providerRef ?? undefined,
      },
    });
    // Link the payment to the order. Other modules (orders, fulfillment)
    // listen on `payment.succeeded` and can act on this.
    await this.prisma.order.update({
      where: { id: updated.orderId },
      data: { paymentId: updated.id },
    });
    this.emit(PaymentEvents.Succeeded, {
      paymentId: updated.id,
      orderId: updated.orderId,
      provider: updated.provider,
      amountCents: updated.amountCents,
      currency: updated.currency,
      at: updated.capturedAt ?? new Date(),
    });
    return updated;
  }

  private async markFailed(paymentId: string, failureReason: string): Promise<Payment> {
    const updated = await this.prisma.payment.update({
      where: { id: paymentId },
      data: { status: PaymentStatus.FAILED, failureReason },
    });
    this.emit(PaymentEvents.Failed, {
      paymentId: updated.id,
      orderId: updated.orderId,
      provider: updated.provider,
      amountCents: updated.amountCents,
      currency: updated.currency,
      at: new Date(),
      failureReason,
    });
    return updated;
  }

  private async markCancelled(paymentId: string): Promise<Payment> {
    const updated = await this.prisma.payment.update({
      where: { id: paymentId },
      data: { status: PaymentStatus.CANCELLED },
    });
    this.emit(PaymentEvents.Cancelled, {
      paymentId: updated.id,
      orderId: updated.orderId,
      provider: updated.provider,
      amountCents: updated.amountCents,
      currency: updated.currency,
      at: new Date(),
    });
    return updated;
  }

  private async markRefunded(paymentId: string): Promise<Payment> {
    const updated = await this.prisma.payment.update({
      where: { id: paymentId },
      data: { status: PaymentStatus.REFUNDED },
    });
    this.emit(PaymentEvents.Refunded, {
      paymentId: updated.id,
      orderId: updated.orderId,
      provider: updated.provider,
      amountCents: updated.amountCents,
      currency: updated.currency,
      at: new Date(),
    });
    return updated;
  }

  private async logAttempt(
    paymentId: string,
    kind: string,
    provider: PaymentProviderKind,
    idempotencyKey: string | undefined,
    request: Record<string, unknown> | null,
    response: Record<string, unknown> | null,
    status: PaymentStatus,
  ): Promise<void> {
    try {
      await this.prisma.paymentAttempt.create({
        data: {
          paymentId,
          kind,
          provider,
          idempotencyKey: idempotencyKey ?? null,
          request: (request as Prisma.InputJsonValue) ?? Prisma.JsonNull,
          response: (response as Prisma.InputJsonValue) ?? Prisma.JsonNull,
          status,
        },
      });
    } catch (err) {
      this.logger.error(`Failed to write payment attempt: ${(err as Error).message}`);
    }
  }

  private async lookupSellerSupabaseId(sellerProfileId: string): Promise<string | null> {
    const profile = await this.prisma.sellerProfile.findUnique({
      where: { id: sellerProfileId },
      select: { user: { select: { supabaseId: true } } },
    });
    return profile?.user?.supabaseId ?? null;
  }

  private emit(event: string, payload: PaymentEventPayload): void {
    try {
      this.events.emit(event, payload);
    } catch (err) {
      this.logger.error(`Failed to emit ${event}: ${(err as Error).message}`);
    }
  }

  private compose(
    payment: Payment,
    clientPayload?: Record<string, unknown> | null,
  ): PaymentResponseDto {
    return {
      id: payment.id,
      orderId: payment.orderId,
      provider: payment.provider,
      providerRef: payment.providerRef,
      amountCents: payment.amountCents,
      currency: payment.currency,
      status: payment.status,
      capturedAt: payment.capturedAt?.toISOString() ?? null,
      failureReason: payment.failureReason,
      clientPayload: clientPayload ?? (payment.metadata as Record<string, unknown> | null),
      createdAt: payment.createdAt.toISOString(),
      updatedAt: payment.updatedAt.toISOString(),
    };
  }
}
