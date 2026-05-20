import { NestFactory } from '@nestjs/core';
import { Logger as PinoLogger } from 'nestjs-pino';

import 'reflect-metadata';

import { initSentry } from '@infrastructure/observability/sentry';

import { AppModule } from './app.module';

/**
 * Worker process entrypoint. Boots the same Nest application context as the
 * HTTP server but does not listen on a port — BullMQ workers (defined as
 * `@Processor(...)` providers within feature modules) start automatically
 * when the context comes up.
 *
 * Run with: `node dist/worker.js` (or via the dev script in package.json).
 *
 * No processors are wired yet — they land with the domain modules that emit
 * jobs (M2 image processing, M5 payment webhooks, etc.).
 */
async function bootstrap(): Promise<void> {
  initSentry();
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(PinoLogger));
  app.enableShutdownHooks();

  const logger = app.get(PinoLogger);
  logger.log('👷 bomboli-worker started');
}

bootstrap().catch((err) => {
  console.error('Failed to bootstrap worker', err);
  process.exit(1);
});
