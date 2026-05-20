import { SetMetadata } from '@nestjs/common';

export const IDEMPOTENT_METADATA_KEY = 'bomboli:idempotent';

/**
 * Opts a route handler into idempotency-key dedupe. Clients must send an
 * `Idempotency-Key` header; replays return the original response. Apply to
 * POST endpoints whose double-submission would cause real-world damage —
 * orders, payment intents, wallet top-ups.
 */
export const Idempotent = (): MethodDecorator => SetMetadata(IDEMPOTENT_METADATA_KEY, true);
