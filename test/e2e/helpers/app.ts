import { VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';

import { AppModule } from '../../../src/app.module';

/**
 * Boots a full Nest application context configured the same way as main.ts
 * (URI versioning, global validation pipe). Tests should call `app.init()`
 * — no port binding is needed because supertest hooks the underlying
 * http.Server directly.
 */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication({ rawBody: true });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(new ZodValidationPipe());
  await app.init();
  return app;
}
