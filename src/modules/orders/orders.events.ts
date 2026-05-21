/**
 * Domain events emitted by the orders module. Notifications (M9), chat
 * system messages (M7), and seller stats recomputation (M8) subscribe.
 */

export const OrderEvents = {
  Created: 'order.created',
  StatusPreparing: 'order.status.preparing',
  StatusOnTheWay: 'order.status.on_the_way',
  StatusDelivered: 'order.status.delivered',
  StatusCancelled: 'order.status.cancelled',
  StatusRefunded: 'order.status.refunded',
} as const;

export type OrderEvent = (typeof OrderEvents)[keyof typeof OrderEvents];

export interface OrderEventPayload {
  orderId: string;
  buyerId: string;
  sellerId: string;
  status: 'PREPARING' | 'ON_THE_WAY' | 'DELIVERED' | 'CANCELLED' | 'REFUNDED';
  previousStatus?: 'PREPARING' | 'ON_THE_WAY' | 'DELIVERED' | 'CANCELLED' | 'REFUNDED';
  at: Date;
}

export function statusToEventName(status: OrderEventPayload['status']): OrderEvent {
  switch (status) {
    case 'PREPARING':
      return OrderEvents.StatusPreparing;
    case 'ON_THE_WAY':
      return OrderEvents.StatusOnTheWay;
    case 'DELIVERED':
      return OrderEvents.StatusDelivered;
    case 'CANCELLED':
      return OrderEvents.StatusCancelled;
    case 'REFUNDED':
      return OrderEvents.StatusRefunded;
  }
}
