import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createTestApp } from './helpers/app';
import { KIN_CENTER, KIN_NEAR, LISTING_TEMPLATES } from './helpers/catalog-fixtures';
import { closeDb, getPrisma, resetAllUsers } from './helpers/db';
import { signSeedToken } from './helpers/jwt';

const TOKEN = (t: string): string => `Bearer ${t}`;

describe('M4 cart + orders e2e', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let buyerToken: string;
  let sellerToken: string;
  let adminToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
    buyerToken = signSeedToken('buyer');
    sellerToken = signSeedToken('seller');
    adminToken = signSeedToken('admin');
  });

  afterAll(async () => {
    await resetAllUsers();
    await app?.close();
    await closeDb();
  });

  beforeEach(async () => {
    await resetAllUsers();
  });

  // ----- Fixture helpers -----

  async function makeSellerWithListing(
    sellerSideToken: string,
    overrides: Record<string, unknown> = {},
  ): Promise<{ listingId: string; sellerId: string }> {
    await request(server)
      .put('/v1/sellers/me/profile')
      .set('Authorization', TOKEN(sellerSideToken))
      .send({ bio: 'x' })
      .expect(200);
    const tpl = LISTING_TEMPLATES.iphone;
    const create = await request(server)
      .post('/v1/listings')
      .set('Authorization', TOKEN(sellerSideToken))
      .send({
        title: tpl.title,
        description: tpl.description,
        category: tpl.category,
        priceCents: tpl.priceCents,
        currency: 'CDF',
        lat: KIN_NEAR.lat,
        lng: KIN_NEAR.lng,
        quantityAvailable: 3,
        ...overrides,
      })
      .expect(201);
    const listingId = create.body.data.id as string;
    await request(server)
      .post(`/v1/listings/${listingId}/publish`)
      .set('Authorization', TOKEN(sellerSideToken))
      .expect(201);
    return { listingId, sellerId: create.body.data.sellerId as string };
  }

  async function ensureBuyerAddress(): Promise<string> {
    const res = await request(server)
      .post('/v1/users/me/addresses')
      .set('Authorization', TOKEN(buyerToken))
      .send({
        label: 'home',
        formatted: '12 Avenue Lumumba, Kinshasa',
        lat: KIN_CENTER.lat,
        lng: KIN_CENTER.lng,
      });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  }

  // ----- Cart -----

  describe('Cart', () => {
    it('GET /v1/cart returns an empty cart for new users', async () => {
      const res = await request(server)
        .get('/v1/cart')
        .set('Authorization', TOKEN(buyerToken));
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        items: [],
        itemCount: 0,
        subtotalCents: 0,
        sellerId: null,
        currency: null,
      });
    });

    it('add → update → remove cycles correctly', async () => {
      const { listingId } = await makeSellerWithListing(sellerToken);

      const added = await request(server)
        .post('/v1/cart/items')
        .set('Authorization', TOKEN(buyerToken))
        .send({ listingId, quantity: 2 });
      expect(added.status).toBe(200);
      expect(added.body.data.items).toHaveLength(1);
      expect(added.body.data.itemCount).toBe(2);
      expect(added.body.data.subtotalCents).toBe(LISTING_TEMPLATES.iphone.priceCents * 2);
      expect(added.body.data.sellerId).not.toBeNull();

      const itemId = added.body.data.items[0].id as string;
      const updated = await request(server)
        .patch(`/v1/cart/items/${itemId}`)
        .set('Authorization', TOKEN(buyerToken))
        .send({ quantity: 1 });
      expect(updated.body.data.itemCount).toBe(1);

      const removed = await request(server)
        .delete(`/v1/cart/items/${itemId}`)
        .set('Authorization', TOKEN(buyerToken));
      expect(removed.body.data.items).toHaveLength(0);
      // Seller + currency reset on empty
      expect(removed.body.data.sellerId).toBeNull();
      expect(removed.body.data.currency).toBeNull();
    });

    it('adding the same listing twice increments quantity (upsert)', async () => {
      const { listingId } = await makeSellerWithListing(sellerToken);
      await request(server)
        .post('/v1/cart/items')
        .set('Authorization', TOKEN(buyerToken))
        .send({ listingId, quantity: 1 })
        .expect(200);
      const second = await request(server)
        .post('/v1/cart/items')
        .set('Authorization', TOKEN(buyerToken))
        .send({ listingId, quantity: 2 });
      expect(second.body.data.items).toHaveLength(1);
      expect(second.body.data.items[0].quantity).toBe(3);
    });

    it('CART_SELLER_CONFLICT when adding from a different seller', async () => {
      const sellerA = await makeSellerWithListing(sellerToken);
      const sellerB = await makeSellerWithListing(adminToken);

      await request(server)
        .post('/v1/cart/items')
        .set('Authorization', TOKEN(buyerToken))
        .send({ listingId: sellerA.listingId, quantity: 1 })
        .expect(200);

      const conflict = await request(server)
        .post('/v1/cart/items')
        .set('Authorization', TOKEN(buyerToken))
        .send({ listingId: sellerB.listingId, quantity: 1 });
      expect(conflict.status).toBe(409);
      expect(conflict.body.error.code).toBe('BOMBOLI_CART_SELLER_CONFLICT');
    });

    it('/replace swaps to a different seller atomically', async () => {
      const sellerA = await makeSellerWithListing(sellerToken);
      const sellerB = await makeSellerWithListing(adminToken);

      await request(server)
        .post('/v1/cart/items')
        .set('Authorization', TOKEN(buyerToken))
        .send({ listingId: sellerA.listingId, quantity: 1 })
        .expect(200);

      const replaced = await request(server)
        .post('/v1/cart/replace')
        .set('Authorization', TOKEN(buyerToken))
        .send({ listingId: sellerB.listingId, quantity: 1 });
      expect(replaced.status).toBe(200);
      expect(replaced.body.data.sellerId).toBe(sellerB.sellerId);
      expect(replaced.body.data.items).toHaveLength(1);
      expect(replaced.body.data.items[0].listing.id).toBe(sellerB.listingId);
    });

    it('rejects adding a DRAFT listing', async () => {
      await request(server)
        .put('/v1/sellers/me/profile')
        .set('Authorization', TOKEN(sellerToken))
        .send({ bio: 'x' });
      const draft = await request(server)
        .post('/v1/listings')
        .set('Authorization', TOKEN(sellerToken))
        .send({
          title: LISTING_TEMPLATES.iphone.title,
          description: LISTING_TEMPLATES.iphone.description,
          category: LISTING_TEMPLATES.iphone.category,
          priceCents: LISTING_TEMPLATES.iphone.priceCents,
          lat: KIN_NEAR.lat,
          lng: KIN_NEAR.lng,
        });
      const res = await request(server)
        .post('/v1/cart/items')
        .set('Authorization', TOKEN(buyerToken))
        .send({ listingId: draft.body.data.id, quantity: 1 });
      expect(res.status).toBe(409);
    });
  });

  // ----- Orders: creation -----

  describe('Orders — creation', () => {
    it('POST /v1/orders creates a PICKUP order from the cart and clears it', async () => {
      const { listingId, sellerId } = await makeSellerWithListing(sellerToken);
      await request(server)
        .post('/v1/cart/items')
        .set('Authorization', TOKEN(buyerToken))
        .send({ listingId, quantity: 2 })
        .expect(200);

      const res = await request(server)
        .post('/v1/orders')
        .set('Authorization', TOKEN(buyerToken))
        .set('Idempotency-Key', 'create-order-1')
        .send({ fulfillmentType: 'PICKUP' });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        sellerId,
        status: 'PREPARING',
        fulfillmentType: 'PICKUP',
        addressSnapshot: null,
        deliveryFeeCents: 0,
        subtotalCents: LISTING_TEMPLATES.iphone.priceCents * 2,
        totalCents: LISTING_TEMPLATES.iphone.priceCents * 2,
      });
      expect(res.body.data.items).toHaveLength(1);

      // Cart cleared
      const cart = await request(server)
        .get('/v1/cart')
        .set('Authorization', TOKEN(buyerToken));
      expect(cart.body.data.items).toHaveLength(0);
      expect(cart.body.data.sellerId).toBeNull();

      // Inventory decremented from 3 → 1
      const listing = await getPrisma().listing.findUnique({ where: { id: listingId } });
      expect(listing!.quantityAvailable).toBe(1);
      expect(listing!.status).toBe('PUBLISHED');
    });

    it('DELIVERY requires addressId and snapshots it onto the order', async () => {
      const { listingId } = await makeSellerWithListing(sellerToken);
      const addressId = await ensureBuyerAddress();
      await request(server)
        .post('/v1/cart/items')
        .set('Authorization', TOKEN(buyerToken))
        .send({ listingId, quantity: 1 })
        .expect(200);

      // Missing addressId → validation
      const bad = await request(server)
        .post('/v1/orders')
        .set('Authorization', TOKEN(buyerToken))
        .set('Idempotency-Key', 'create-bad')
        .send({ fulfillmentType: 'DELIVERY' });
      expect(bad.status).toBe(400);

      const good = await request(server)
        .post('/v1/orders')
        .set('Authorization', TOKEN(buyerToken))
        .set('Idempotency-Key', 'create-good')
        .send({ fulfillmentType: 'DELIVERY', addressId, deliveryFeeCents: 500 });
      expect(good.status).toBe(201);
      expect(good.body.data.addressSnapshot).toMatchObject({
        label: 'home',
        formatted: '12 Avenue Lumumba, Kinshasa',
        lat: expect.any(Number),
      });
      expect(good.body.data.deliveryFeeCents).toBe(500);
      expect(good.body.data.totalCents).toBe(LISTING_TEMPLATES.iphone.priceCents + 500);
    });

    it('rejects ordering when cart is empty', async () => {
      const res = await request(server)
        .post('/v1/orders')
        .set('Authorization', TOKEN(buyerToken))
        .set('Idempotency-Key', 'create-empty')
        .send({ fulfillmentType: 'PICKUP' });
      expect(res.status).toBe(409);
    });

    it('OUT_OF_STOCK when requesting more than available', async () => {
      const { listingId } = await makeSellerWithListing(sellerToken, { quantityAvailable: 2 });
      // Get cart item id, then update past stock via PATCH (cart layer doesn't
      // know inventory yet — only the order creation locks + verifies).
      const added = await request(server)
        .post('/v1/cart/items')
        .set('Authorization', TOKEN(buyerToken))
        .send({ listingId, quantity: 2 })
        .expect(200);
      await request(server)
        .patch(`/v1/cart/items/${added.body.data.items[0].id}`)
        .set('Authorization', TOKEN(buyerToken))
        .send({ quantity: 5 })
        .expect(200);

      const res = await request(server)
        .post('/v1/orders')
        .set('Authorization', TOKEN(buyerToken))
        .set('Idempotency-Key', 'create-out')
        .send({ fulfillmentType: 'PICKUP' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('BOMBOLI_OUT_OF_STOCK');
    });

    it('auto-flips the listing to SOLD_OUT when inventory hits zero', async () => {
      const { listingId } = await makeSellerWithListing(sellerToken, { quantityAvailable: 1 });
      await request(server)
        .post('/v1/cart/items')
        .set('Authorization', TOKEN(buyerToken))
        .send({ listingId, quantity: 1 })
        .expect(200);
      const res = await request(server)
        .post('/v1/orders')
        .set('Authorization', TOKEN(buyerToken))
        .set('Idempotency-Key', 'create-soldout')
        .send({ fulfillmentType: 'PICKUP' });
      expect(res.status).toBe(201);

      const listing = await getPrisma().listing.findUnique({ where: { id: listingId } });
      expect(listing!.status).toBe('SOLD_OUT');
      expect(listing!.quantityAvailable).toBe(0);
    });
  });

  // ----- Orders: reads -----

  describe('Orders — reads', () => {
    it('GET /v1/orders/:id is accessible to buyer and seller, denied to others', async () => {
      const { listingId } = await makeSellerWithListing(sellerToken);
      await request(server)
        .post('/v1/cart/items')
        .set('Authorization', TOKEN(buyerToken))
        .send({ listingId, quantity: 1 })
        .expect(200);
      const order = await request(server)
        .post('/v1/orders')
        .set('Authorization', TOKEN(buyerToken))
        .set('Idempotency-Key', 'create-read')
        .send({ fulfillmentType: 'PICKUP' });
      const id = order.body.data.id;

      const asBuyer = await request(server)
        .get(`/v1/orders/${id}`)
        .set('Authorization', TOKEN(buyerToken));
      expect(asBuyer.status).toBe(200);

      const asSeller = await request(server)
        .get(`/v1/orders/${id}`)
        .set('Authorization', TOKEN(sellerToken));
      expect(asSeller.status).toBe(200);

      const asThird = await request(server)
        .get(`/v1/orders/${id}`)
        .set('Authorization', TOKEN(adminToken));
      expect(asThird.status).toBe(403);
    });

    it('GET /v1/orders lists buyer and seller views separately', async () => {
      const { listingId } = await makeSellerWithListing(sellerToken);
      await request(server)
        .post('/v1/cart/items')
        .set('Authorization', TOKEN(buyerToken))
        .send({ listingId, quantity: 1 })
        .expect(200);
      await request(server)
        .post('/v1/orders')
        .set('Authorization', TOKEN(buyerToken))
        .set('Idempotency-Key', 'list-1')
        .send({ fulfillmentType: 'PICKUP' })
        .expect(201);

      const buyerList = await request(server)
        .get('/v1/orders?role=buyer')
        .set('Authorization', TOKEN(buyerToken));
      expect(buyerList.body.data.results).toHaveLength(1);

      const sellerList = await request(server)
        .get('/v1/orders?role=seller')
        .set('Authorization', TOKEN(sellerToken));
      expect(sellerList.body.data.results).toHaveLength(1);

      // Status filter
      const filtered = await request(server)
        .get('/v1/orders?role=buyer&status=DELIVERED')
        .set('Authorization', TOKEN(buyerToken));
      expect(filtered.body.data.results).toHaveLength(0);
    });
  });

  // ----- Orders: transitions -----

  describe('Orders — status transitions', () => {
    async function createPickupOrder(): Promise<string> {
      const { listingId } = await makeSellerWithListing(sellerToken);
      await request(server)
        .post('/v1/cart/items')
        .set('Authorization', TOKEN(buyerToken))
        .send({ listingId, quantity: 1 })
        .expect(200);
      const order = await request(server)
        .post('/v1/orders')
        .set('Authorization', TOKEN(buyerToken))
        .set('Idempotency-Key', `create-${Date.now()}-${Math.random()}`)
        .send({ fulfillmentType: 'PICKUP' });
      expect(order.status).toBe(201);
      return order.body.data.id as string;
    }

    it('seller can move PREPARING → ON_THE_WAY → DELIVERED', async () => {
      const id = await createPickupOrder();

      const r1 = await request(server)
        .post(`/v1/orders/${id}/status`)
        .set('Authorization', TOKEN(sellerToken))
        .send({ to: 'ON_THE_WAY' });
      expect(r1.status).toBe(200);
      expect(r1.body.data.status).toBe('ON_THE_WAY');

      const r2 = await request(server)
        .post(`/v1/orders/${id}/status`)
        .set('Authorization', TOKEN(sellerToken))
        .send({ to: 'DELIVERED' });
      expect(r2.body.data.status).toBe('DELIVERED');
    });

    it('buyer cannot transition status', async () => {
      const id = await createPickupOrder();
      const res = await request(server)
        .post(`/v1/orders/${id}/status`)
        .set('Authorization', TOKEN(buyerToken))
        .send({ to: 'ON_THE_WAY' });
      expect(res.status).toBe(403);
    });

    it('rejects skipping states (PREPARING → DELIVERED)', async () => {
      const id = await createPickupOrder();
      const res = await request(server)
        .post(`/v1/orders/${id}/status`)
        .set('Authorization', TOKEN(sellerToken))
        .send({ to: 'DELIVERED' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('BOMBOLI_INVALID_ORDER_TRANSITION');
    });

    it('buyer can cancel while PREPARING; restock follows', async () => {
      const { listingId } = await makeSellerWithListing(sellerToken, { quantityAvailable: 2 });
      await request(server)
        .post('/v1/cart/items')
        .set('Authorization', TOKEN(buyerToken))
        .send({ listingId, quantity: 1 })
        .expect(200);
      const order = await request(server)
        .post('/v1/orders')
        .set('Authorization', TOKEN(buyerToken))
        .set('Idempotency-Key', 'cancel-1')
        .send({ fulfillmentType: 'PICKUP' });
      const id = order.body.data.id;

      // qty went 2 → 1
      let listing = await getPrisma().listing.findUnique({ where: { id: listingId } });
      expect(listing!.quantityAvailable).toBe(1);

      const cancel = await request(server)
        .post(`/v1/orders/${id}/cancel`)
        .set('Authorization', TOKEN(buyerToken))
        .send({ reason: 'changed my mind' });
      expect(cancel.status).toBe(200);
      expect(cancel.body.data.status).toBe('CANCELLED');

      // Restocked 1 → 2
      listing = await getPrisma().listing.findUnique({ where: { id: listingId } });
      expect(listing!.quantityAvailable).toBe(2);
    });

    it('buyer cannot cancel after ON_THE_WAY; seller can', async () => {
      const id = await createPickupOrder();
      await request(server)
        .post(`/v1/orders/${id}/status`)
        .set('Authorization', TOKEN(sellerToken))
        .send({ to: 'ON_THE_WAY' })
        .expect(200);

      const buyerCancel = await request(server)
        .post(`/v1/orders/${id}/cancel`)
        .set('Authorization', TOKEN(buyerToken))
        .send({});
      expect(buyerCancel.status).toBe(403);

      const sellerCancel = await request(server)
        .post(`/v1/orders/${id}/cancel`)
        .set('Authorization', TOKEN(sellerToken))
        .send({});
      expect(sellerCancel.status).toBe(200);
      expect(sellerCancel.body.data.status).toBe('CANCELLED');
    });

    it('cannot cancel a DELIVERED order', async () => {
      const id = await createPickupOrder();
      await request(server)
        .post(`/v1/orders/${id}/status`)
        .set('Authorization', TOKEN(sellerToken))
        .send({ to: 'ON_THE_WAY' });
      await request(server)
        .post(`/v1/orders/${id}/status`)
        .set('Authorization', TOKEN(sellerToken))
        .send({ to: 'DELIVERED' });
      const res = await request(server)
        .post(`/v1/orders/${id}/cancel`)
        .set('Authorization', TOKEN(sellerToken))
        .send({});
      expect(res.status).toBe(409);
    });
  });
});
