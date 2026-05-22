import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createTestApp } from './helpers/app';
import { closeDb, getPrisma, resetUserTables } from './helpers/db';
import { signCustomToken, signExpiredToken, signSeedToken } from './helpers/jwt';

const WEBHOOK_SECRET = process.env.SUPABASE_WEBHOOK_SECRET!;

describe('Auth e2e', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app?.close();
    await closeDb();
  });

  beforeEach(async () => {
    await resetUserTables();
  });

  describe('GET /v1/health', () => {
    it('is public and returns ok', async () => {
      const res = await request(server).get('/v1/health');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        data: { status: 'ok' },
      });
    });
  });

  describe('GET /v1/users/me', () => {
    it('401s without a token', async () => {
      const res = await request(server).get('/v1/users/me');
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ success: false });
    });

    it('401s with a token signed by a wrong secret', async () => {
      const token = signSeedToken('buyer', { secret: 'not-the-real-secret-32-chars-long-x' });
      const res = await request(server).get('/v1/users/me').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
    });

    it('401s with an expired token', async () => {
      const token = signExpiredToken('buyer');
      const res = await request(server).get('/v1/users/me').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
    });

    it('401s when audience is wrong', async () => {
      const token = signSeedToken('buyer', { aud: 'service-role' });
      const res = await request(server).get('/v1/users/me').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
    });

    it('returns the seeded buyer for a valid token', async () => {
      const token = signSeedToken('buyer');
      const res = await request(server).get('/v1/users/me').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        supabaseId: '00000000-0000-0000-0000-000000000002',
        email: 'test+buyer@bomboli.test',
        isAdmin: false,
        sellerProfileId: null,
        delivererId: null,
      });
    });

    it('JIT-provisions a previously unknown user', async () => {
      const sub = 'cccccccc-cccc-cccc-cccc-ccccccccccc1';
      const email = 'jit+new@bomboli.test';
      const token = signCustomToken({ sub, email });

      const before = await getPrisma().user.findUnique({ where: { supabaseId: sub } });
      expect(before).toBeNull();

      const res = await request(server).get('/v1/users/me').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ supabaseId: sub, email, isAdmin: false });

      const after = await getPrisma().user.findUnique({ where: { supabaseId: sub } });
      expect(after).not.toBeNull();
    });

    it('401s on JIT when token has no email claim', async () => {
      const sub = 'dddddddd-dddd-dddd-dddd-ddddddddddd1';
      const token = signCustomToken({ sub });
      const res = await request(server).get('/v1/users/me').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
    });
  });

  describe('POST /v1/internal/supabase/auth-hook', () => {
    const sub = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1';
    const validPayload = {
      type: 'INSERT' as const,
      schema: 'auth',
      table: 'users',
      record: {
        id: sub,
        email: 'webhook+new@bomboli.test',
        phone: '+243812345678',
        raw_user_meta_data: { displayName: 'Webhook Test' },
      },
    };

    it('401s without auth header', async () => {
      const res = await request(server)
        .post('/v1/internal/supabase/auth-hook')
        .send(validPayload);
      expect(res.status).toBe(401);
    });

    it('401s with wrong secret', async () => {
      const res = await request(server)
        .post('/v1/internal/supabase/auth-hook')
        .set('Authorization', 'Bearer wrong-secret-value-here-is-long-enough')
        .send(validPayload);
      expect(res.status).toBe(401);
    });

    it('provisions a user on INSERT with valid secret', async () => {
      const res = await request(server)
        .post('/v1/internal/supabase/auth-hook')
        .set('Authorization', `Bearer ${WEBHOOK_SECRET}`)
        .send(validPayload);
      expect(res.status).toBe(204);

      const user = await getPrisma().user.findUnique({ where: { supabaseId: sub } });
      expect(user).toMatchObject({
        email: 'webhook+new@bomboli.test',
        phone: '+243812345678',
        displayName: 'Webhook Test',
        isAdmin: false,
      });
    });

    it('is idempotent on repeated INSERT/UPDATE', async () => {
      await request(server)
        .post('/v1/internal/supabase/auth-hook')
        .set('Authorization', `Bearer ${WEBHOOK_SECRET}`)
        .send(validPayload)
        .expect(204);

      const updated = await request(server)
        .post('/v1/internal/supabase/auth-hook')
        .set('Authorization', `Bearer ${WEBHOOK_SECRET}`)
        .send({
          ...validPayload,
          type: 'UPDATE',
          record: { ...validPayload.record, phone: '+243899999999' },
        });
      expect(updated.status).toBe(204);

      const user = await getPrisma().user.findUnique({ where: { supabaseId: sub } });
      expect(user?.phone).toBe('+243899999999');
    });

    it('400s when record is missing required fields', async () => {
      const res = await request(server)
        .post('/v1/internal/supabase/auth-hook')
        .set('Authorization', `Bearer ${WEBHOOK_SECRET}`)
        .send({ type: 'INSERT', schema: 'auth', table: 'users', record: { id: sub } });
      expect(res.status).toBe(400);
    });

    it('ignores webhooks for unrelated tables silently', async () => {
      const res = await request(server)
        .post('/v1/internal/supabase/auth-hook')
        .set('Authorization', `Bearer ${WEBHOOK_SECRET}`)
        .send({
          type: 'INSERT',
          schema: 'public',
          table: 'something_else',
          record: { id: sub },
        });
      expect(res.status).toBe(204);
    });
  });
});
