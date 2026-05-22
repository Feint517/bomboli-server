import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createTestApp } from './helpers/app';
import { closeDb, resetAllUsers } from './helpers/db';
import { signSeedToken } from './helpers/jwt';

const TOKEN_HEADER = (token: string) => `Bearer ${token}`;

describe('M1 profile e2e', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let buyerToken: string;
  let sellerToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
    buyerToken = signSeedToken('buyer');
    sellerToken = signSeedToken('seller');
  });

  afterAll(async () => {
    await resetAllUsers();
    await app?.close();
    await closeDb();
  });

  beforeEach(async () => {
    await resetAllUsers();
  });

  describe('GET /v1/users/me', () => {
    it('returns the new profile fields with sensible defaults', async () => {
      const res = await request(server)
        .get('/v1/users/me')
        .set('Authorization', TOKEN_HEADER(buyerToken));
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        isAdmin: false,
        sellerProfileId: null,
        delivererId: null,
        preferredLanguage: 'fr',
        themePref: 'system',
        avatarUrl: null,
        defaultLocation: null,
      });
    });
  });

  describe('PATCH /v1/users/me', () => {
    it('updates displayName, language, theme, and defaultLocation', async () => {
      const res = await request(server)
        .patch('/v1/users/me')
        .set('Authorization', TOKEN_HEADER(buyerToken))
        .send({
          displayName: 'Jean Kinshasa',
          preferredLanguage: 'fr',
          themePref: 'dark',
          defaultLocation: { lat: -4.3217, lng: 15.3125 },
        });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        displayName: 'Jean Kinshasa',
        themePref: 'dark',
        defaultLocation: { lat: expect.any(Number), lng: expect.any(Number) },
      });
      expect(res.body.data.defaultLocation.lat).toBeCloseTo(-4.3217, 4);
      expect(res.body.data.defaultLocation.lng).toBeCloseTo(15.3125, 4);
    });

    it('clears defaultLocation when null is sent', async () => {
      await request(server)
        .patch('/v1/users/me')
        .set('Authorization', TOKEN_HEADER(buyerToken))
        .send({ defaultLocation: { lat: -4.3, lng: 15.3 } })
        .expect(200);
      const res = await request(server)
        .patch('/v1/users/me')
        .set('Authorization', TOKEN_HEADER(buyerToken))
        .send({ defaultLocation: null });
      expect(res.status).toBe(200);
      expect(res.body.data.defaultLocation).toBeNull();
    });

    it('rejects unknown theme', async () => {
      const res = await request(server)
        .patch('/v1/users/me')
        .set('Authorization', TOKEN_HEADER(buyerToken))
        .send({ themePref: 'sepia' });
      expect(res.status).toBe(400);
    });

    it('rejects out-of-range coordinates', async () => {
      const res = await request(server)
        .patch('/v1/users/me')
        .set('Authorization', TOKEN_HEADER(buyerToken))
        .send({ defaultLocation: { lat: 999, lng: 0 } });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /v1/users/me/avatar', () => {
    it('returns a signed upload URL for an allowed content-type', async () => {
      const res = await request(server)
        .post('/v1/users/me/avatar')
        .set('Authorization', TOKEN_HEADER(buyerToken))
        .send({ contentType: 'image/jpeg' });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        bucket: 'avatars',
        path: expect.stringMatching(/^00000000-0000-0000-0000-000000000002\/.*\.jpg$/),
        signedUrl: expect.stringContaining('avatars'),
      });
    });

    it('rejects unsupported content-types', async () => {
      const res = await request(server)
        .post('/v1/users/me/avatar')
        .set('Authorization', TOKEN_HEADER(buyerToken))
        .send({ contentType: 'image/gif' });
      expect(res.status).toBe(400);
    });
  });

  describe('Addresses', () => {
    it('full CRUD + default invariant', async () => {
      // Create #1 — becomes default (first address)
      const a1 = await request(server)
        .post('/v1/users/me/addresses')
        .set('Authorization', TOKEN_HEADER(buyerToken))
        .send({
          label: 'home',
          formatted: '12 Avenue Lumumba, Kinshasa',
          lat: -4.3217,
          lng: 15.3125,
          gateCode: '#4521',
        });
      expect(a1.status).toBe(201);
      expect(a1.body.data).toMatchObject({
        label: 'home',
        isDefault: true,
        lat: expect.any(Number),
        lng: expect.any(Number),
        gateCode: '#4521',
      });
      expect(a1.body.data.lat).toBeCloseTo(-4.3217, 4);

      // Create #2 — not default, explicitly false
      const a2 = await request(server)
        .post('/v1/users/me/addresses')
        .set('Authorization', TOKEN_HEADER(buyerToken))
        .send({
          label: 'work',
          formatted: '5 Boulevard du 30 Juin, Gombe',
          lat: -4.3001,
          lng: 15.3,
          isDefault: false,
        });
      expect(a2.status).toBe(201);
      expect(a2.body.data.isDefault).toBe(false);

      // List ordered: default first
      const list = await request(server)
        .get('/v1/users/me/addresses')
        .set('Authorization', TOKEN_HEADER(buyerToken));
      expect(list.status).toBe(200);
      expect(list.body.data).toHaveLength(2);
      expect(list.body.data[0].id).toBe(a1.body.data.id);
      expect(list.body.data[0].isDefault).toBe(true);

      // Promote #2 to default
      const promote = await request(server)
        .post(`/v1/users/me/addresses/${a2.body.data.id}/default`)
        .set('Authorization', TOKEN_HEADER(buyerToken));
      expect(promote.status).toBe(200);
      expect(promote.body.data.isDefault).toBe(true);

      // Verify exactly one default exists
      const after = await request(server)
        .get('/v1/users/me/addresses')
        .set('Authorization', TOKEN_HEADER(buyerToken));
      const defaults = after.body.data.filter((a: { isDefault: boolean }) => a.isDefault);
      expect(defaults).toHaveLength(1);
      expect(defaults[0].id).toBe(a2.body.data.id);

      // Update fields on #1
      const updated = await request(server)
        .patch(`/v1/users/me/addresses/${a1.body.data.id}`)
        .set('Authorization', TOKEN_HEADER(buyerToken))
        .send({ floor: '3', deliveryInstructions: 'Sonner deux fois' });
      expect(updated.status).toBe(200);
      expect(updated.body.data).toMatchObject({
        floor: '3',
        deliveryInstructions: 'Sonner deux fois',
      });

      // Delete #1
      await request(server)
        .delete(`/v1/users/me/addresses/${a1.body.data.id}`)
        .set('Authorization', TOKEN_HEADER(buyerToken))
        .expect(204);

      const final = await request(server)
        .get('/v1/users/me/addresses')
        .set('Authorization', TOKEN_HEADER(buyerToken));
      expect(final.body.data).toHaveLength(1);
    });

    it('cannot touch another user\'s address', async () => {
      const mine = await request(server)
        .post('/v1/users/me/addresses')
        .set('Authorization', TOKEN_HEADER(buyerToken))
        .send({ label: 'home', formatted: '12 Av. X', lat: -4, lng: 15 });
      expect(mine.status).toBe(201);

      const sellerView = await request(server)
        .patch(`/v1/users/me/addresses/${mine.body.data.id}`)
        .set('Authorization', TOKEN_HEADER(sellerToken))
        .send({ label: 'hacked' });
      expect(sellerView.status).toBe(403);

      const sellerDelete = await request(server)
        .delete(`/v1/users/me/addresses/${mine.body.data.id}`)
        .set('Authorization', TOKEN_HEADER(sellerToken));
      expect(sellerDelete.status).toBe(403);
    });

    it('validates required fields on create', async () => {
      const res = await request(server)
        .post('/v1/users/me/addresses')
        .set('Authorization', TOKEN_HEADER(buyerToken))
        .send({ label: 'home', formatted: '12', lat: 200, lng: 15 });
      expect(res.status).toBe(400);
    });
  });

  describe('Devices', () => {
    it('register → list → delete', async () => {
      const reg = await request(server)
        .post('/v1/users/me/devices')
        .set('Authorization', TOKEN_HEADER(buyerToken))
        .send({ platform: 'android', pushToken: 'fcm-token-aaa-1' });
      expect(reg.status).toBe(201);
      expect(reg.body.data).toMatchObject({ platform: 'android' });

      const list = await request(server)
        .get('/v1/users/me/devices')
        .set('Authorization', TOKEN_HEADER(buyerToken));
      expect(list.status).toBe(200);
      expect(list.body.data).toHaveLength(1);

      await request(server)
        .delete(`/v1/users/me/devices/${reg.body.data.id}`)
        .set('Authorization', TOKEN_HEADER(buyerToken))
        .expect(204);
    });

    it('upserts on same pushToken across re-registrations', async () => {
      const t = 'fcm-token-stable';
      const first = await request(server)
        .post('/v1/users/me/devices')
        .set('Authorization', TOKEN_HEADER(buyerToken))
        .send({ platform: 'ios', pushToken: t });
      const second = await request(server)
        .post('/v1/users/me/devices')
        .set('Authorization', TOKEN_HEADER(buyerToken))
        .send({ platform: 'ios', pushToken: t });
      expect(first.body.data.id).toBe(second.body.data.id);

      const list = await request(server)
        .get('/v1/users/me/devices')
        .set('Authorization', TOKEN_HEADER(buyerToken));
      expect(list.body.data).toHaveLength(1);
    });

    it('forbids deleting another user\'s device', async () => {
      const mine = await request(server)
        .post('/v1/users/me/devices')
        .set('Authorization', TOKEN_HEADER(buyerToken))
        .send({ platform: 'android', pushToken: 'fcm-token-private' });

      const sellerDelete = await request(server)
        .delete(`/v1/users/me/devices/${mine.body.data.id}`)
        .set('Authorization', TOKEN_HEADER(sellerToken));
      expect(sellerDelete.status).toBe(403);
    });
  });

  describe('Recently viewed', () => {
    it('returns empty list when nothing recorded', async () => {
      const res = await request(server)
        .get('/v1/users/me/recently-viewed')
        .set('Authorization', TOKEN_HEADER(buyerToken));
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ listingIds: [] });
    });
  });
});
