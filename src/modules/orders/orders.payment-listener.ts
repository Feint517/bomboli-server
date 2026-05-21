import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { OrdersService } from './orders.service';

interface PaymentFailedPayload {
  orderId: string;
  failureReason?: string | null;
}

/**
 * Bridges payment events into the orders module. Lives in its own provider
 * so OrdersService stays unaware of payment-specific event shapes — and
 * Nest can keep modules decoupled.
 */
@Injectable()
export class OrdersPaymentListener {
  private readonly logger = new Logger(OrdersPaymentListener.name);

  constructor(private readonly orders: OrdersService) {}

  @OnEvent('payment.failed', { async: true })
  async onPaymentFailed(payload: PaymentFailedPayload): Promise<void> {
    try {
      await this.orders.cancelBySystem(
        payload.orderId,
        `Payment failed: ${payload.failureReason ?? 'unknown'}`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to auto-cancel order ${payload.orderId} after payment failure: ${(err as Error).message}`,
      );
    }
  }
}
