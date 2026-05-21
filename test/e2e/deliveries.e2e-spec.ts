import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createTestApp } from './helpers/app';
import { KIN_CENTER, KIN_NEAR, LISTING_TEMPLATES } from './helpers/catalog-fixtures';
import { closeDb, getPrisma, resetAllUsers } from './helpers/db';
import { signSeedToken } from './helpers/jwt';

const TOKEN = (t: string): string => `Bearer ${t}`;

// supabaseIds (matches the prisma seed)
const ADMIN_SUB = '00000000-0000-0000-0000-000000000001';
const BUYER_SUB = '00000000-0000-0000-0000-000000000002';
const SELLER_SUB = '00000000-0000-0000-0000-000000000003';

describe('M6 deliveries e2e', () => {
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

  // ----- Fixtures -----

  async function userId(supabaseId: string): Promise<string> {
    const user = await getPrisma().user.findUnique({ where: { supabaseId } });
    return user!.id;
  }

  async function makeDeliveryOrder(): Promise<string> {
    // Seller becomes a seller, lists, buyer creates a DELIVERY order
    await request(server)
      .put('/v1/sellers/me/profile')
      .set('Authorization', TOKEN(sellerToken))
      .send({ bio: 'x', pickupPoint: { lat: KIN_NEAR.lat, lng: KIN_NEAR.lng } })
      .expect(200);
    const listing = await request(server)
      .post('/v1/listings')
      .set('Authorization', TOKEN(sellerToken))
      .send({
        title: LISTING_TEMPLATES.iphone.title,
        description: LISTING_TEMPLATES.iphone.description,
        category: LISTING_TEMPLATES.iphone.category,
        priceCents: LISTING_TEMPLATES.iphone.priceCents,
        currency: 'CDF',
        lat: KIN_NEAR.lat,
        lng: KIN_NEAR.lng,
        quantityAvailable: 3,
      })
      .expect(201);
    await request(server)
      .post(`/v1/listings/${listing.body.data.id}/publish`)
      .set('Authorization', TOKEN(sellerToken))
      .expect(201);

    const addr = await request(server)
      .post('/v1/users/me/addresses')
      .set('Authorization', TOKEN(buyerToken))
      .send({ label: 'home', formatted: '12 Av X', lat: KIN_CENTER.lat, lng: KIN_CENTER.lng });
    expect(addr.status).toBe(201);

    await request(server)
      .post('/v1/cart/items')
      .set('Authorization', TOKEN(buyerToken))
      .send({ listingId: listing.body.data.id, quantity: 1 })
      .expect(200);
    const order = await request(server)
      .post('/v1/orders')
      .set('Authorization', TOKEN(buyerToken))
      .set('Idempotency-Key', `delivery-${Date.now()}-${Math.random()}`)
      .send({ fulfillmentType: 'DELIVERY', addressId: addr.body.data.id, deliveryFeeCents: 500 });
    expect(order.status).toBe(201);
    return order.body.data.id as string;
  }

  // ----- Admin creates deliverer -----

  describe('Admin — POST /v1/admin/deliverers', () => {
    it('creates a deliverer for an existing user and promotes their role', async () => {
      const buyerUserId = await userId(BUYER_SUB);
      const res = await request(server)
        .post('/v1/admin/deliverers')
        .set('Authorization', TOKEN(adminToken))
        .send({ userId: buyerUserId, vehicleType: 'MOTO', phone: '+243812345678' });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        userId: buyerUserId,
        vehicleType: 'MOTO',
        available: false,
        currentLocation: null,
      });
      // Phone is masked to "+243•••5678"
      expect(res.body.data.phoneMasked).toMatch(/5678$/);

      const updated = await getPrisma().user.findUnique({ where: { id: buyerUserId } });
      expect(updated!.role).toBe('DELIVERY_PARTNER');
    });

    it('rejects non-admin callers', async () => {
      const buyerUserId = await userId(BUYER_SUB);
      const res = await request(server)
        .post('/v1/admin/deliverers')
        .set('Authorization', TOKEN(sellerToken))
        .send({ userId: buyerUserId, vehicleType: 'MOTO', phone: '+243812345678' });
      expect(res.status).toBe(403);
    });

    it('refuses to create a duplicate deliverer for the same user', async () => {
      const buyerUserId = await userId(BUYER_SUB);
      await request(server)
        .post('/v1/admin/deliverers')
        .set('Authorization', TOKEN(adminToken))
        .send({ userId: buyerUserId, vehicleType: 'MOTO', phone: '+243812345678' })
        .expect(201);
      const second = await request(server)
        .post('/v1/admin/deliverers')
        .set('Authorization', TOKEN(adminToken))
        .send({ userId: buyerUserId, vehicleType: 'VOITURE', phone: '+243812345679' });
      expect(second.status).toBe(409);
    });
  });

  // ----- Deliverer self endpoints -----

  describe('Deliverer self endpoints', () => {
    it('GET /v1/deliveries/me 404s when not registered as a deliverer', async () => {
      const res = await request(server)
        .get('/v1/deliveries/me')
        .set('Authorization', TOKEN(buyerToken));
      expect(res.status).toBe(404);
    });

    it('PATCH /v1/deliveries/me/location updates GPS', async () => {
      const buyerUserId = await userId(BUYER_SUB);
      await request(server)
        .post('/v1/admin/deliverers')
        .set('Authorization', TOKEN(adminToken))
        .send({ userId: buyerUserId, vehicleType: 'MOTO', phone: '+243812345678' })
        .expect(201);

      const res = await request(server)
        .patch('/v1/deliveries/me/location')
        .set('Authorization', TOKEN(buyerToken))
        .send({ lat: KIN_NEAR.lat, lng: KIN_NEAR.lng });
      expect(res.status).toBe(200);
      expect(res.body.data.currentLocation).not.toBeNull();
      expect(res.body.data.currentLocation.lat).toBeCloseTo(KIN_NEAR.lat, 4);
    });

    it('PATCH /v1/deliveries/me/available toggles the flag', async () => {
      const buyerUserId = await userId(BUYER_SUB);
      await request(server)
        .post('/v1/admin/deliverers')
        .set('Authorization', TOKEN(adminToken))
        .send({ userId: buyerUserId, vehicleType: 'MOTO', phone: '+243812345678' })
        .expect(201);

      const on = await request(server)
        .patch('/v1/deliveries/me/available')
        .set('Authorization', TOKEN(buyerToken))
        .send({ available: true });
      expect(on.body.data.available).toBe(true);

      const off = await request(server)
        .patch('/v1/deliveries/me/available')
        .set('Authorization', TOKEN(buyerToken))
        .send({ available: false });
      expect(off.body.data.available).toBe(false);
    });
  });

  // ----- Assignment + ETA -----

  describe('Admin — POST /v1/admin/orders/:id/assign-deliverer', () => {
    async function setupAssignableOrder(): Promise<{ orderId: string; delivererId: string }> {
      const orderId = await makeDeliveryOrder();
      const buyerUserId = await userId(BUYER_SUB);
      const deliverer = await request(server)
        .post('/v1/admin/deliverers')
        .set('Authorization', TOKEN(adminToken))
        .send({ userId: buyerUserId, vehicleType: 'MOTO', phone: '+243812345678' });
      expect(deliverer.status).toBe(201);
      return { orderId, delivererId: deliverer.body.data.id };
    }

    it('assigns a deliverer, stamps ETA, and embeds the summary on order reads', async () => {
      const { orderId, delivererId } = await setupAssignableOrder();
      const assign = await request(server)
        .post(`/v1/admin/orders/${orderId}/assign-deliverer`)
        .set('Authorization', TOKEN(adminToken))
        .send({ delivererId });
      expect(assign.status).toBe(200);
      expect(assign.body.data).toMatchObject({ orderId, delivererId });
      expect(assign.body.data.etaAt).toBeTruthy();
      expect(typeof assign.body.data.distanceKm).toBe('number');

      const orderRead = await request(server)
        .get(`/v1/orders/${orderId}`)
        .set('Authorization', TOKEN(buyerToken));
      expect(orderRead.status).toBe(200);
      expect(orderRead.body.data.delivererId).toBe(delivererId);
      expect(orderRead.body.data.etaAt).toBeTruthy();
      expect(orderRead.body.data.deliverer).toMatchObject({
        id: delivererId,
        vehicleType: 'MOTO',
        phoneMasked: expect.stringMatching(/5678$/),
      });
    });

    it('refuses to assign to a PICKUP order', async () => {
      // Build a PICKUP order separately
      await request(server)
        .put('/v1/sellers/me/profile')
        .set('Authorization', TOKEN(sellerToken))
        .send({ bio: 'x' })
        .expect(200);
      const listing = await request(server)
        .post('/v1/listings')
        .set('Authorization', TOKEN(sellerToken))
        .send({
          title: LISTING_TEMPLATES.iphone.title,
          description: LISTING_TEMPLATES.iphone.description,
          category: LISTING_TEMPLATES.iphone.category,
          priceCents: LISTING_TEMPLATES.iphone.priceCents,
          lat: KIN_NEAR.lat,
          lng: KIN_NEAR.lng,
        })
        .expect(201);
      await request(server)
        .post(`/v1/listings/${listing.body.data.id}/publish`)
        .set('Authorization', TOKEN(sellerToken))
        .expect(201);
      await request(server)
        .post('/v1/cart/items')
        .set('Authorization', TOKEN(buyerToken))
        .send({ listingId: listing.body.data.id, quantity: 1 })
        .expect(200);
      const pickupOrder = await request(server)
        .post('/v1/orders')
        .set('Authorization', TOKEN(buyerToken))
        .set('Idempotency-Key', `pickup-${Date.now()}`)
        .send({ fulfillmentType: 'PICKUP' });
      expect(pickupOrder.status).toBe(201);

      const buyerUserId = await userId(BUYER_SUB);
      const deliverer = await request(server)
        .post('/v1/admin/deliverers')
        .set('Authorization', TOKEN(adminToken))
        .send({ userId: buyerUserId, vehicleType: 'MOTO', phone: '+243812345678' });

      const res = await request(server)
        .post(`/v1/admin/orders/${pickupOrder.body.data.id}/assign-deliverer`)
        .set('Authorization', TOKEN(adminToken))
        .send({ delivererId: deliverer.body.data.id });
      expect(res.status).toBe(409);
    });

    it('refuses non-admin callers', async () => {
      const { orderId, delivererId } = await setupAssignableOrder();
      const res = await request(server)
        .post(`/v1/admin/orders/${orderId}/assign-deliverer`)
        .set('Authorization', TOKEN(sellerToken))
        .send({ delivererId });
      expect(res.status).toBe(403);
    });
  });

  // ----- Status transitions by deliverer -----

  describe('Order status transitions by deliverer', () => {
    it('the assigned deliverer can move PREPARING → ON_THE_WAY → DELIVERED', async () => {
      const orderId = await makeDeliveryOrder();
      const buyerUserId = await userId(BUYER_SUB);
      const deliverer = await request(server)
        .post('/v1/admin/deliverers')
        .set('Authorization', TOKEN(adminToken))
        .send({ userId: buyerUserId, vehicleType: 'MOTO', phone: '+243812345678' });
      await request(server)
        .post(`/v1/admin/orders/${orderId}/assign-deliverer`)
        .set('Authorization', TOKEN(adminToken))
        .send({ delivererId: deliverer.body.data.id })
        .expect(200);

      // Buyer's role has flipped to DELIVERY_PARTNER; their token's sub still resolves
      // to the same user; transition allowed.
      const enRoute = await request(server)
        .post(`/v1/orders/${orderId}/status`)
        .set('Authorization', TOKEN(buyerToken))
        .send({ to: 'ON_THE_WAY' });
      expect(enRoute.status).toBe(200);
      expect(enRoute.body.data.status).toBe('ON_THE_WAY');

      const delivered = await request(server)
        .post(`/v1/orders/${orderId}/status`)
        .set('Authorization', TOKEN(buyerToken))
        .send({ to: 'DELIVERED' });
      expect(delivered.status).toBe(200);
      expect(delivered.body.data.status).toBe('DELIVERED');
    });

    it('a deliverer who is NOT assigned cannot move status', async () => {
      const orderId = await makeDeliveryOrder();
      // Make the ADMIN user a deliverer (not assigned to this order)
      const adminUserId = await userId(ADMIN_SUB);
      await request(server)
        .post('/v1/admin/deliverers')
        .set('Authorization', TOKEN(adminToken))
        .send({ userId: adminUserId, vehicleType: 'MOTO', phone: '+243812345677' })
        .expect(201);

      // Wait — making admin a deliverer flips their role to DELIVERY_PARTNER, which
      // breaks subsequent admin-token usage. That's fine for this single assertion.
      const res = await request(server)
        .post(`/v1/orders/${orderId}/status`)
        .set('Authorization', TOKEN(adminToken))
        .send({ to: 'ON_THE_WAY' });
      expect(res.status).toBe(403);
    });

    it('seller can still transition (existing behavior preserved)', async () => {
      const orderId = await makeDeliveryOrder();
      const res = await request(server)
        .post(`/v1/orders/${orderId}/status`)
        .set('Authorization', TOKEN(sellerToken))
        .send({ to: 'ON_THE_WAY' });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('ON_THE_WAY');
    });
  });

  // ----- Use seller variable to silence the unused-import lint -----
  void SELLER_SUB;
});
