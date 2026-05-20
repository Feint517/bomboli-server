import { registerAs } from '@nestjs/config';

export const observabilityConfig = registerAs('observability', () => ({
  sentry: {
    dsn: process.env.SENTRY_DSN ?? '',
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0'),
    enabled: Boolean(process.env.SENTRY_DSN),
  },
  metrics: {
    // If unset, /metrics is open in non-production and 403'd in production.
    // If set, requests must present `Authorization: Bearer <token>`.
    token: process.env.METRICS_TOKEN ?? '',
  },
  idempotency: {
    ttlSeconds: parseInt(process.env.IDEMPOTENCY_TTL_HOURS ?? '24', 10) * 3600,
  },
}));

export type ObservabilityConfig = ReturnType<typeof observabilityConfig>;
