import { VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger as PinoLogger } from 'nestjs-pino';
import { ZodValidationPipe } from 'nestjs-zod';

import 'reflect-metadata';

import { initSentry } from '@infrastructure/observability/sentry';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  // Sentry must initialize before Nest bootstraps so process-level
  // instrumentation captures startup errors.
  initSentry();

  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });

  app.useLogger(app.get(PinoLogger));

  const config = app.get(ConfigService);
  const port = config.get<number>('app.port', 3002);
  const allowedOrigins = config.get<string[]>('app.allowedOrigins', []);

  app.use(helmet());
  app.use(compression());
  app.use(cookieParser());

  app.enableCors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  // ZodValidationPipe handles createZodDto classes; falls back to a no-op
  // for non-zod DTOs (we don't use class-validator DTOs in this codebase).
  app.useGlobalPipes(new ZodValidationPipe());

  app.enableShutdownHooks();

  await app.listen(port, '0.0.0.0');

  const logger = app.get(PinoLogger);
  logger.log(`🚀 bomboli-api listening on http://0.0.0.0:${port} (${process.env.NODE_ENV})`);
}

bootstrap().catch((err) => {
  console.error('Failed to bootstrap', err);
  process.exit(1);
});
