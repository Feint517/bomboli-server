import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createTestApp } from './helpers/app';
import {
  KIN_CENTER,
  KIN_FAR,
  KIN_MID,
  KIN_NEAR,
  KIN_WAY_OUT,
  LISTING_TEMPLATES,
  ListingTemplateKey,
} from './helpers/catalog-fixtures';
import { closeDb, resetAllUsers } from './helpers/db';
import { signSeedToken } from './helpers/jwt';

const TOKEN = (t: string): string => `Bearer ${t}`;

describe('M3 discovery e2e', () => {
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

  // ------------------- Fixtures helpers -------------------

  async function ensureSeller(token: string, label: string): Promise<void> {
    await request(server)
      .put('/v1/sellers/me/profile')
      .set('Authorization', TOKEN(token))
      .send({ bio: label })
      .expect(200);
  }

  interface MakeListingOpts {
    key: ListingTemplateKey;
    at: { lat: number; lng: number };
    publish?: boolean;
    overrides?: Record<string, unknown>;
    token?: string;
  }

  async function makeListing(opts: MakeListingOpts): Promise<string> {
    const tpl = LISTING_TEMPLATES[opts.key];
    const create = await request(server)
      .post('/v1/listings')
      .set('Authorization', TOKEN(opts.token ?? buyerToken))
      .send({
        title: tpl.title,
        description: tpl.description,
        category: tpl.category,
        priceCents: tpl.priceCents,
        currency: 'CDF',
        lat: opts.at.lat,
        lng: opts.at.lng,
        ...opts.overrides,
      });
    expect(create.status).toBe(201);
    const id = create.body.data.id as string;
    if (opts.publish !== false) {
      await request(server)
        .post(`/v1/listings/${id}/publish`)
        .set('Authorization', TOKEN(opts.token ?? buyerToken))
        .expect(201);
    }
    return id;
  }

  // ------------------- Search -------------------

  describe('GET /v1/search', () => {
    it('full-text matches title (French)', async () => {
      await ensureSeller(buyerToken, 'Buyer-as-seller');
      await makeListing({ key: 'iphone', at: KIN_NEAR });
      await makeListing({ key: 'savonNoir', at: KIN_NEAR });

      const res = await request(server).get('/v1/search').query({ q: 'iphone' });
      expect(res.status).toBe(200);
      expect(res.body.data.results).toHaveLength(1);
      expect(res.body.data.results[0].title).toMatch(/iPhone/i);
    });

    it('excludes DRAFT and soft-deleted listings', async () => {
      await ensureSeller(buyerToken, 'x');
      await makeListing({ key: 'iphone', at: KIN_NEAR, publish: false }); // DRAFT
      await makeListing({ key: 'samsung', at: KIN_NEAR });

      const res = await request(server).get('/v1/search').query({ q: 'reconditionné' });
      expect(res.status).toBe(200);
      // Only the published samsung shows up
      expect(res.body.data.results).toHaveLength(1);
      expect(res.body.data.results[0].title).toMatch(/Samsung/);
    });

    it('filters by category', async () => {
      await ensureSeller(buyerToken, 'x');
      await makeListing({ key: 'iphone', at: KIN_NEAR });
      await makeListing({ key: 'savonNoir', at: KIN_NEAR });

      const res = await request(server)
        .get('/v1/search')
        .query({ category: 'COSMETIQUE' });
      expect(res.body.data.results.every((r: { category: string }) => r.category === 'COSMETIQUE')).toBe(
        true,
      );
      expect(res.body.data.results.length).toBeGreaterThan(0);
    });

    it('applies the per-category cap so a 22km-away SECONDE_MAIN listing is excluded', async () => {
      await ensureSeller(buyerToken, 'x');
      await makeListing({ key: 'iphone', at: KIN_FAR }); // ≈22km — outside SECONDE_MAIN(15)
      await makeListing({ key: 'samsung', at: KIN_NEAR }); // ≈3km — inside

      const res = await request(server)
        .get('/v1/search')
        .query({ category: 'SECONDE_MAIN', lat: KIN_CENTER.lat, lng: KIN_CENTER.lng });
      const titles = res.body.data.results.map((r: { title: string }) => r.title);
      expect(titles).toContain(LISTING_TEMPLATES.samsung.title);
      expect(titles).not.toContain(LISTING_TEMPLATES.iphone.title);
    });

    it('respects the user-supplied maxDistanceKm', async () => {
      await ensureSeller(buyerToken, 'x');
      await makeListing({ key: 'savonNoir', at: KIN_NEAR }); // ≈3km
      await makeListing({ key: 'beurreKarite', at: KIN_MID }); // ≈10km

      const res = await request(server)
        .get('/v1/search')
        .query({
          category: 'COSMETIQUE',
          maxDistanceKm: 5,
          lat: KIN_CENTER.lat,
          lng: KIN_CENTER.lng,
        });
      const titles = res.body.data.results.map((r: { title: string }) => r.title);
      expect(titles).toContain(LISTING_TEMPLATES.savonNoir.title);
      expect(titles).not.toContain(LISTING_TEMPLATES.beurreKarite.title);
    });

    it('sort=priceAsc orders by price', async () => {
      await ensureSeller(buyerToken, 'x');
      await makeListing({ key: 'iphone', at: KIN_NEAR });
      await makeListing({ key: 'samsung', at: KIN_NEAR });

      const res = await request(server)
        .get('/v1/search')
        .query({ category: 'SECONDE_MAIN', sort: 'priceAsc' });
      const prices = res.body.data.results.map((r: { priceCents: number }) => r.priceCents);
      expect(prices).toEqual([...prices].sort((a, b) => a - b));
    });

    it('sort=distance orders by distance from the supplied point', async () => {
      await ensureSeller(buyerToken, 'x');
      await makeListing({ key: 'savonNoir', at: KIN_MID });   // ≈10km
      await makeListing({ key: 'beurreKarite', at: KIN_NEAR }); // ≈3km

      const res = await request(server)
        .get('/v1/search')
        .query({
          category: 'COSMETIQUE',
          sort: 'distance',
          lat: KIN_CENTER.lat,
          lng: KIN_CENTER.lng,
        });
      expect(res.body.data.results[0].title).toBe(LISTING_TEMPLATES.beurreKarite.title);
    });

    it('400s without any filter (no q, category, or coords)', async () => {
      const res = await request(server).get('/v1/search');
      expect(res.status).toBe(400);
    });

    it('400s when sort=distance but coords missing', async () => {
      const res = await request(server)
        .get('/v1/search')
        .query({ q: 'iphone', sort: 'distance' });
      expect(res.status).toBe(400);
    });

    it('pagination: offset + limit', async () => {
      await ensureSeller(buyerToken, 'x');
      await makeListing({ key: 'iphone', at: KIN_NEAR });
      await makeListing({ key: 'samsung', at: KIN_NEAR });

      const page1 = await request(server)
        .get('/v1/search')
        .query({ category: 'SECONDE_MAIN', limit: 1, offset: 0 });
      const page2 = await request(server)
        .get('/v1/search')
        .query({ category: 'SECONDE_MAIN', limit: 1, offset: 1 });
      expect(page1.body.data.results).toHaveLength(1);
      expect(page2.body.data.results).toHaveLength(1);
      expect(page1.body.data.results[0].id).not.toBe(page2.body.data.results[0].id);
      expect(page1.body.data.total).toBe(2);
      expect(page1.body.data.hasMore).toBe(true);
      expect(page2.body.data.hasMore).toBe(false);
    });
  });

  // ------------------- Feed -------------------

  describe('GET /v1/feed', () => {
    it('returns empty proximity rails when no coords supplied', async () => {
      await ensureSeller(buyerToken, 'x');
      await makeListing({ key: 'iphone', at: KIN_NEAR });

      const res = await request(server).get('/v1/feed');
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        aDecouvrir: [],
        bonsPlans: [],
        bientotTermine: [],
        servicesPresDeToi: [],
        vendeursProches: [],
        vuRecemment: [],
      });
    });

    it('aDecouvrir returns recently-published listings within range', async () => {
      await ensureSeller(buyerToken, 'x');
      await makeListing({ key: 'iphone', at: KIN_NEAR });
      await makeListing({ key: 'savonNoir', at: KIN_NEAR });
      // Way outside all caps — should not appear.
      await makeListing({ key: 'pagne', at: KIN_WAY_OUT });

      const res = await request(server)
        .get('/v1/feed')
        .query({ lat: KIN_CENTER.lat, lng: KIN_CENTER.lng });
      const titles = res.body.data.aDecouvrir.map((l: { title: string }) => l.title);
      expect(titles).toContain(LISTING_TEMPLATES.iphone.title);
      expect(titles).toContain(LISTING_TEMPLATES.savonNoir.title);
      expect(titles).not.toContain(LISTING_TEMPLATES.pagne.title);
    });

    it('servicesPresDeToi only contains SERVICES category', async () => {
      await ensureSeller(buyerToken, 'x');
      await makeListing({ key: 'iphone', at: KIN_NEAR });
      await makeListing({ key: 'coiffure', at: KIN_NEAR });
      await makeListing({ key: 'reparation', at: KIN_MID });

      const res = await request(server)
        .get('/v1/feed')
        .query({ lat: KIN_CENTER.lat, lng: KIN_CENTER.lng });
      expect(res.body.data.servicesPresDeToi.length).toBeGreaterThanOrEqual(2);
      expect(
        res.body.data.servicesPresDeToi.every(
          (l: { category: string }) => l.category === 'SERVICES',
        ),
      ).toBe(true);
    });

    it('bientotTermine surfaces listings with quantityAvailable ≤ 2', async () => {
      await ensureSeller(buyerToken, 'x');
      await makeListing({ key: 'iphone', at: KIN_NEAR, overrides: { quantityAvailable: 5 } });
      await makeListing({ key: 'samsung', at: KIN_NEAR, overrides: { quantityAvailable: 1 } });

      const res = await request(server)
        .get('/v1/feed')
        .query({ lat: KIN_CENTER.lat, lng: KIN_CENTER.lng });
      const titles = res.body.data.bientotTermine.map((l: { title: string }) => l.title);
      expect(titles).toContain(LISTING_TEMPLATES.samsung.title);
      expect(titles).not.toContain(LISTING_TEMPLATES.iphone.title);
    });

    it('vendeursProches returns distinct sellers sorted by distance', async () => {
      // Seller A: buyer-seed at KIN_NEAR
      await ensureSeller(buyerToken, 'Buyer-as-seller');
      await makeListing({ key: 'iphone', at: KIN_NEAR });
      // Seller B: seeded seller at KIN_MID (further away)
      await ensureSeller(sellerToken, 'Seeded seller');
      await makeListing({ key: 'reparation', at: KIN_MID, token: sellerToken });

      const res = await request(server)
        .get('/v1/feed')
        .query({ lat: KIN_CENTER.lat, lng: KIN_CENTER.lng });
      expect(res.body.data.vendeursProches).toHaveLength(2);
      // Closer seller (Buyer Test) first
      const [first, second] = res.body.data.vendeursProches as Array<{ displayName: string; distanceKm: number }>;
      expect(first.displayName).toBe('Buyer Test');
      expect(second.displayName).toBe('Seller Test');
      expect(first.distanceKm).toBeLessThan(second.distanceKm);
    });

    it('vuRecemment is empty without auth and populated with auth after viewing a listing', async () => {
      await ensureSeller(buyerToken, 'x');
      const id = await makeListing({ key: 'iphone', at: KIN_NEAR });

      // Authed view → records
      await request(server)
        .get(`/v1/listings/${id}`)
        .set('Authorization', TOKEN(buyerToken))
        .expect(200);
      await new Promise((r) => setTimeout(r, 60));

      // Anonymous feed: vuRecemment empty
      const anon = await request(server)
        .get('/v1/feed')
        .query({ lat: KIN_CENTER.lat, lng: KIN_CENTER.lng });
      expect(anon.body.data.vuRecemment).toEqual([]);

      // Authed feed: vuRecemment includes the viewed listing
      const authed = await request(server)
        .get('/v1/feed')
        .query({ lat: KIN_CENTER.lat, lng: KIN_CENTER.lng })
        .set('Authorization', TOKEN(buyerToken));
      const ids = authed.body.data.vuRecemment.map((l: { id: string }) => l.id);
      expect(ids).toContain(id);
    });
  });
});
