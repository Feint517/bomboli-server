import * as Sentry from '@sentry/node';

let initialized = false;

/**
 * Initialize Sentry from environment. Called from main.ts before Nest
 * bootstrap so process-level instrumentation captures startup errors too.
 * No-ops if SENTRY_DSN is unset — local dev and tests stay clean.
 */
export function initSentry(): void {
  if (initialized) return;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0'),
    release: process.env.APP_VERSION,
  });
  initialized = true;
}

export function captureException(err: unknown, context?: Record<string, unknown>): void {
  if (!initialized) return;
  Sentry.captureException(err, context ? { extra: context } : undefined);
}

export { Sentry };
