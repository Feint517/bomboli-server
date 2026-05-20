/**
 * Named queues for the BullMQ worker. Tokens are used both to register the
 * queue in NestJS DI and to identify the queue in Redis.
 *
 * Producers (HTTP services) and consumers (worker.ts processors) reference
 * the same token. Add a new queue here first, then build the processor.
 */
export const Queues = {
  /** Image variant generation (sm/md/lg) for listing + seller uploads. */
  ImageProcessing: 'image-processing',
  /** Push + email fan-out triggered by domain events. */
  Notifications: 'notifications',
  /** Recompute SellerStats, listing aggregates, etc. (debounced). */
  Aggregates: 'aggregates',
  /** Outbound webhook deliveries with retries. */
  Webhooks: 'webhooks',
  /** Nightly payment reconciliation pulls. */
  Reconciliation: 'reconciliation',
} as const;

export type QueueName = (typeof Queues)[keyof typeof Queues];

export const ALL_QUEUES: readonly QueueName[] = Object.values(Queues);
