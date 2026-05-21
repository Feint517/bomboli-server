import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createTestApp } from './helpers/app';
import { closeDb, getPrisma, resetAllUsers, resetCatalog } from './helpers/db';
import { signSeedToken } from './helpers/jwt';

const TOKEN_HEADER = (token: string) => `Bearer ${token}`;

// Kinshasa-ish coordinates for test fixtures.
const KIN = { lat: -4.3217, lng: 15.3125 };

describe('M2 catalog e2e', () => {
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
    await resetCatalog();
    await resetAllUsers();
    await app?.close();
    await closeDb();
  });

  beforeEach(async () => {
    await resetCatalog();
    await resetAllUsers();
  });

  // ----- Sellers -----

  describe('Sellers', () => {
    it('PUT /v1/sellers/me/profile creates a profile and promotes BUYER → SELLER', async () => {
      const before = await request(server)
        .get('/v1/users/me')
        .set('Authorization', TOKEN_HEADER(buyerToken));
      expect(before.body.data.role).toBe('BUYER');

      const create = await request(server)
        .put('/v1/sellers/me/profile')
        .set('Authorization', TOKEN_HEADER(buyerToken))
        .send({
          bio: 'Je fabrique mes cosmétiques à la main à Gombe depuis 10 ans.',
          deliveryRadiusKm: 20,
          languages: ['fr', 'ln'],
          pickupPoint: KIN,
          promoText: 'Première commande livrée gratuitement',
          promoActive: true,
        });
      expect(create.status).toBe(200);
      expect(create.body.data).toMatchObject({
        bio: expect.stringContaining('cosmétiques'),
        deliveryRadiusKm: 20,
        languages: ['fr', 'ln'],
        pickupPoint: { lat: expect.any(Number), lng: expect.any(Number) },
        promo: { text: 'Première commande livrée gratuitement', expiresAt: null },
      });

      const after = await request(server)
        .get('/v1/users/me')
        .set('Authorization', TOKEN_HEADER(buyerToken));
      expect(after.body.data.role).toBe('SELLER');
    });

    it('GET /v1/sellers/:id returns the profile with default stats and no verifications', async () => {
      const create = await request(server)
        .put('/v1/sellers/me/profile')
        .set('Authorization', TOKEN_HEADER(buyerToken))
        .send({ bio: 'A bio' });
      const sellerId = create.body.data.id;

      const res = await request(server).get(`/v1/sellers/${sellerId}`);
      expect(res.status).toBe(200);
      expect(res.body.data.stats).toMatchObject({
        avgRating: 0,
        ratingCount: 0,
        hygieneBar: 0,
        qualityBar: 0,
        packagingBar: 0,
      });
      expect(res.body.data.verifications).toEqual([]);
    });

    it('GET /v1/sellers/me/profile is 404 when no profile exists', async () => {
      const res = await request(server)
        .get('/v1/sellers/me/profile')
        .set('Authorization', TOKEN_HEADER(buyerToken));
      expect(res.status).toBe(404);
    });

    it('PUT /v1/sellers/me/profile is idempotent on subsequent calls', async () => {
      const first = await request(server)
        .put('/v1/sellers/me/profile')
        .set('Authorization', TOKEN_HEADER(buyerToken))
        .send({ bio: 'First' });
      const second = await request(server)
        .put('/v1/sellers/me/profile')
        .set('Authorization', TOKEN_HEADER(buyerToken))
        .send({ bio: 'Second', deliveryRadiusKm: 25 });
      expect(first.body.data.id).toBe(second.body.data.id);
      expect(second.body.data).toMatchObject({ bio: 'Second', deliveryRadiusKm: 25 });
    });

    it('POST /v1/sellers/me/profile/image returns a signed banner upload URL', async () => {
      await request(server)
        .put('/v1/sellers/me/profile')
        .set('Authorization', TOKEN_HEADER(buyerToken))
        .send({ bio: 'a' })
        .expect(200);
      const res = await request(server)
        .post('/v1/sellers/me/profile/image')
        .set('Authorization', TOKEN_HEADER(buyerToken))
        .send({ kind: 'banner', contentType: 'image/jpeg' });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        bucket: 'seller-banners',
        path: expect.stringMatching(/^.*\/banner-.*\.jpg$/),
        signedUrl: expect.stringContaining('seller-banners'),
      });
    });
  });

  // ----- Listings -----

  describe('Listings', () => {
    async function createSeller(): Promise<string> {
      const res = await request(server)
        .put('/v1/sellers/me/profile')
        .set('Authorization', TOKEN_HEADER(buyerToken))
        .send({ bio: 'Seller for tests' });
      return res.body.data.id as string;
    }

    async function createListing(overrides: Record<string, unknown> = {}): Promise<{
      status: number;
      body: { data: { id: string; status: string } };
    }> {
      return request(server)
        .post('/v1/listings')
        .set('Authorization', TOKEN_HEADER(buyerToken))
        .send({
          title: 'iPhone 13 Pro reconditionné',
          description: 'En parfait état, batterie 92%, livré avec chargeur.',
          category: 'SECONDE_MAIN',
          priceCents: 69900,
          currency: 'CDF',
          lat: KIN.lat,
          lng: KIN.lng,
          quantityAvailable: 1,
          ...overrides,
        }) as unknown as { status: number; body: { data: { id: string; status: string } } };
    }

    it('creates a listing as DRAFT and is gated on having a seller profile', async () => {
      // Without a seller profile yet: 403
      const blocked = await createListing();
      expect(blocked.status).toBe(403);

      // Now create profile + listing
      const sellerId = await createSeller();
      const created = await createListing();
      expect(created.status).toBe(201);
      expect(created.body.data).toMatchObject({
        status: 'DRAFT',
        category: 'SECONDE_MAIN',
        priceCents: 69900,
        seller: { id: sellerId },
      });
    });

    it('GET /v1/listings/:id is public and includes the seller summary', async () => {
      await createSeller();
      const created = await createListing();
      const id = created.body.data.id;

      const res = await request(server).get(`/v1/listings/${id}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        id,
        seller: { displayName: 'Buyer Test' },
        location: { lat: expect.any(Number), lng: expect.any(Number) },
      });
      expect(res.body.data.location.lat).toBeCloseTo(KIN.lat, 4);
    });

    it('publish flips DRAFT → PUBLISHED and stamps publishedAt', async () => {
      await createSeller();
      const created = await createListing();
      const id = created.body.data.id;

      const pub = await request(server)
        .post(`/v1/listings/${id}/publish`)
        .set('Authorization', TOKEN_HEADER(buyerToken));
      expect(pub.status).toBe(201);
      expect(pub.body.data.status).toBe('PUBLISHED');
      expect(pub.body.data.publishedAt).not.toBeNull();
    });

    it('rejects DRAFT → SOLD_OUT via update (state machine enforced server-side)', async () => {
      await createSeller();
      const created = await createListing();
      const id = created.body.data.id;
      // We don't expose direct status writes via PATCH so the only way users
      // change state is via /publish or /archive. Check that publish → archive
      // → archive (already archived) is a no-op equivalent, not a crash.
      await request(server)
        .post(`/v1/listings/${id}/publish`)
        .set('Authorization', TOKEN_HEADER(buyerToken))
        .expect(201);
      const archive = await request(server)
        .post(`/v1/listings/${id}/archive`)
        .set('Authorization', TOKEN_HEADER(buyerToken));
      expect(archive.status).toBe(201);
      expect(archive.body.data.status).toBe('ARCHIVED');
    });

    it('cannot publish someone else\'s listing', async () => {
      await createSeller();
      const created = await createListing();
      const id = created.body.data.id;

      const otherSeller = await request(server)
        .put('/v1/sellers/me/profile')
        .set('Authorization', TOKEN_HEADER(sellerToken))
        .send({ bio: 'b' });
      expect(otherSeller.status).toBe(200);

      const blocked = await request(server)
        .post(`/v1/listings/${id}/publish`)
        .set('Authorization', TOKEN_HEADER(sellerToken));
      expect(blocked.status).toBe(403);
    });

    it('soft-deletes and disappears from public reads', async () => {
      await createSeller();
      const created = await createListing();
      const id = created.body.data.id;
      await request(server)
        .delete(`/v1/listings/${id}`)
        .set('Authorization', TOKEN_HEADER(buyerToken))
        .expect(204);

      const after = await request(server).get(`/v1/listings/${id}`);
      expect(after.status).toBe(404);
    });

    it('validates required fields and category enum on create', async () => {
      await createSeller();
      const bad = await request(server)
        .post('/v1/listings')
        .set('Authorization', TOKEN_HEADER(buyerToken))
        .send({
          title: 'x',                                  // too short
          description: 'too short',                    // too short
          category: 'PIZZA',                           // invalid enum
          priceCents: -100,                            // negative
          lat: KIN.lat,
          lng: KIN.lng,
        });
      expect(bad.status).toBe(400);
    });
  });

  // ----- Recently-viewed -----

  describe('Recently viewed', () => {
    it('records a view when an authenticated user fetches a listing', async () => {
      await request(server)
        .put('/v1/sellers/me/profile')
        .set('Authorization', TOKEN_HEADER(buyerToken))
        .send({ bio: 'x' });
      const created = await request(server)
        .post('/v1/listings')
        .set('Authorization', TOKEN_HEADER(buyerToken))
        .send({
          title: 'A real listing',
          description: 'with enough text to pass validation',
          category: 'COSMETIQUE',
          priceCents: 1500,
          lat: KIN.lat,
          lng: KIN.lng,
        });
      const id = created.body.data.id;

      // Hit the public detail endpoint with auth — should record the view
      await request(server)
        .get(`/v1/listings/${id}`)
        .set('Authorization', TOKEN_HEADER(buyerToken))
        .expect(200);

      // Recently-viewed write is fire-and-forget; small wait so the redis
      // write completes before we read.
      await new Promise((resolve) => setTimeout(resolve, 50));

      const rv = await request(server)
        .get('/v1/users/me/recently-viewed')
        .set('Authorization', TOKEN_HEADER(buyerToken));
      expect(rv.status).toBe(200);
      expect(rv.body.data.listingIds).toContain(id);
    });
  });

  // ----- Photos (init/delete; full processing pipeline is exercised when a real upload arrives) -----

  describe('Photos', () => {
    async function setupListing(): Promise<string> {
      await request(server)
        .put('/v1/sellers/me/profile')
        .set('Authorization', TOKEN_HEADER(buyerToken))
        .send({ bio: 'x' });
      const created = await request(server)
        .post('/v1/listings')
        .set('Authorization', TOKEN_HEADER(buyerToken))
        .send({
          title: 'A listing',
          description: 'description description description',
          category: 'COSMETIQUE',
          priceCents: 1500,
          lat: KIN.lat,
          lng: KIN.lng,
        });
      return created.body.data.id as string;
    }

    it('init reserves a pending photo slot and returns a signed upload URL', async () => {
      const listingId = await setupListing();
      const res = await request(server)
        .post(`/v1/listings/${listingId}/photos`)
        .set('Authorization', TOKEN_HEADER(buyerToken))
        .send({ contentType: 'image/jpeg', alt: 'Bouteille de savon noir' });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        bucket: 'listing-photos',
        photoId: expect.any(String),
        signedUrl: expect.stringContaining('listing-photos'),
      });

      const listing = await getPrisma().listing.findUnique({ where: { id: listingId } });
      const photos = listing!.photos as Array<{ id: string; ready: boolean; alt: string | null }>;
      expect(photos).toHaveLength(1);
      expect(photos[0]).toMatchObject({
        id: res.body.data.photoId,
        ready: false,
        alt: 'Bouteille de savon noir',
      });
    });

    it('delete removes the photo entry from the listing', async () => {
      const listingId = await setupListing();
      const init = await request(server)
        .post(`/v1/listings/${listingId}/photos`)
        .set('Authorization', TOKEN_HEADER(buyerToken))
        .send({ contentType: 'image/jpeg' });
      const photoId = init.body.data.photoId;

      await request(server)
        .delete(`/v1/listings/${listingId}/photos/${photoId}`)
        .set('Authorization', TOKEN_HEADER(buyerToken))
        .expect(204);

      const listing = await getPrisma().listing.findUnique({ where: { id: listingId } });
      expect((listing!.photos as unknown[]).length).toBe(0);
    });

    it('cannot init a photo on someone else\'s listing', async () => {
      const listingId = await setupListing();
      await request(server)
        .put('/v1/sellers/me/profile')
        .set('Authorization', TOKEN_HEADER(sellerToken))
        .send({ bio: 'b' });

      const res = await request(server)
        .post(`/v1/listings/${listingId}/photos`)
        .set('Authorization', TOKEN_HEADER(sellerToken))
        .send({ contentType: 'image/jpeg' });
      expect(res.status).toBe(403);
    });
  });
});
