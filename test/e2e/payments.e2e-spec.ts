import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHmac } from 'crypto';
import request from 'supertest';

import { createTestApp } from './helpers/app';
import { KIN_CENTER, KIN_NEAR, LISTING_TEMPLATES } from './helpers/catalog-fixtures';
import { closeDb, getPrisma, resetAllUsers } from './helpers/db';
import { signSeedToken } from './helpers/jwt';

const TOKEN = (t: string): string => `Bearer ${t}`;

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET!;
const PAWAPAY_WEBHOOK_SECRET = process.env.PAWAPAY_WEBHOOK_SECRET!;

describe('M5 payments e2e', () => {
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

  async function setupOrder(): Promise<string> {
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
    await request(server)
      .post('/v1/cart/items')
      .set('Authorization', TOKEN(buyerToken))
      .send({ listingId: listing.body.data.id, quantity: 1 })
      .expect(200);
    const order = await request(server)
      .post('/v1/orders')
      .set('Authorization', TOKEN(buyerToken))
      .set('Idempotency-Key', `order-${Date.now()}-${Math.random()}`)
      .send({ fulfillmentType: 'PICKUP' });
    expect(order.status).toBe(201);
    return order.body.data.id as string;
  }

  async function createManualPayment(orderId: string): Promise<string> {
    const res = await request(server)
      .post(`/v1/orders/${orderId}/payment`)
      .set('Authorization', TOKEN(buyerToken))
      .set('Idempotency-Key', `pay-${Date.now()}-${Math.random()}`)
      .send({ provider: 'MANUAL' });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('PENDING');
    expect(res.body.data.provider).toBe('MANUAL');
    return res.body.data.id as string;
  }

  // ----- Manual flow -----

  describe('Manual provider — full happy path', () => {
    it('create → admin manual-confirm → order.paymentId set, payment SUCCEEDED', async () => {
      const orderId = await setupOrder();
      const paymentId = await createManualPayment(orderId);

      // Order does not yet have paymentId
      let order = await getPrisma().order.findUnique({ where: { id: orderId } });
      expect(order!.paymentId).toBeNull();

      // Admin confirms
      const confirm = await request(server)
        .post('/v1/admin/payments/manual-confirm')
        .set('Authorization', TOKEN(adminToken))
        .send({ paymentId, externalRef: 'USSD-tx-12345' });
      expect(confirm.status).toBe(200);
      expect(confirm.body.data).toMatchObject({
        id: paymentId,
        status: 'SUCCEEDED',
        provider: 'MANUAL',
      });

      // Order now linked
      order = await getPrisma().order.findUnique({ where: { id: orderId } });
      expect(order!.paymentId).toBe(paymentId);

      // Payment audit attempt was logged
      const attempts = await getPrisma().paymentAttempt.findMany({ where: { paymentId } });
      expect(attempts.some((a) => a.kind === 'confirm')).toBe(true);
    });

    it('refuses to manual-confirm twice', async () => {
      const orderId = await setupOrder();
      const paymentId = await createManualPayment(orderId);

      await request(server)
        .post('/v1/admin/payments/manual-confirm')
        .set('Authorization', TOKEN(adminToken))
        .send({ paymentId })
        .expect(200);

      const second = await request(server)
        .post('/v1/admin/payments/manual-confirm')
        .set('Authorization', TOKEN(adminToken))
        .send({ paymentId });
      expect(second.status).toBe(409);
    });

    it('returns the existing PENDING payment on duplicate create', async () => {
      const orderId = await setupOrder();
      const first = await request(server)
        .post(`/v1/orders/${orderId}/payment`)
        .set('Authorization', TOKEN(buyerToken))
        .set('Idempotency-Key', 'pay-dup-1')
        .send({ provider: 'MANUAL' });
      expect(first.status).toBe(201);

      const second = await request(server)
        .post(`/v1/orders/${orderId}/payment`)
        .set('Authorization', TOKEN(buyerToken))
        .set('Idempotency-Key', 'pay-dup-2')
        .send({ provider: 'MANUAL' });
      expect(second.status).toBe(201);
      expect(second.body.data.id).toBe(first.body.data.id);
    });
  });

  // ----- Authorization -----

  describe('Authorization', () => {
    it('buyer cannot pay for another user\'s order', async () => {
      const orderId = await setupOrder();
      // Try to initiate payment from a different user (the seller, in this case)
      const res = await request(server)
        .post(`/v1/orders/${orderId}/payment`)
        .set('Authorization', TOKEN(sellerToken))
        .set('Idempotency-Key', 'pay-other')
        .send({ provider: 'MANUAL' });
      expect(res.status).toBe(403);
    });

    it('seller can read payments on their own orders; admin cannot read someone else\'s', async () => {
      const orderId = await setupOrder();
      const paymentId = await createManualPayment(orderId);

      const asBuyer = await request(server)
        .get(`/v1/payments/${paymentId}`)
        .set('Authorization', TOKEN(buyerToken));
      expect(asBuyer.status).toBe(200);

      const asSeller = await request(server)
        .get(`/v1/payments/${paymentId}`)
        .set('Authorization', TOKEN(sellerToken));
      expect(asSeller.status).toBe(200);

      const asAdmin = await request(server)
        .get(`/v1/payments/${paymentId}`)
        .set('Authorization', TOKEN(adminToken));
      // Admin role does NOT bypass — admin is a third party here
      expect(asAdmin.status).toBe(403);
    });

    it('non-admin cannot call manual-confirm or refund', async () => {
      const orderId = await setupOrder();
      const paymentId = await createManualPayment(orderId);

      const manualConfirm = await request(server)
        .post('/v1/admin/payments/manual-confirm')
        .set('Authorization', TOKEN(buyerToken))
        .send({ paymentId });
      expect(manualConfirm.status).toBe(403);

      const refund = await request(server)
        .post(`/v1/admin/payments/${paymentId}/refund`)
        .set('Authorization', TOKEN(sellerToken))
        .send({});
      expect(refund.status).toBe(403);
    });
  });

  // ----- Provider gating -----

  describe('Provider gating', () => {
    it('returns 503 when Stripe is not configured', async () => {
      const orderId = await setupOrder();
      const res = await request(server)
        .post(`/v1/orders/${orderId}/payment`)
        .set('Authorization', TOKEN(buyerToken))
        .set('Idempotency-Key', 'pay-stripe-503')
        .send({ provider: 'STRIPE' });
      expect(res.status).toBe(503);
    });

    it('returns 503 when Pawapay is not configured', async () => {
      const orderId = await setupOrder();
      const res = await request(server)
        .post(`/v1/orders/${orderId}/payment`)
        .set('Authorization', TOKEN(buyerToken))
        .set('Idempotency-Key', 'pay-pawapay-503')
        .send({ provider: 'PAWAPAY', phone: '+243812345678', operator: 'VODACOM_MPESA_COD' });
      expect(res.status).toBe(503);
    });

    it('returns 400 for PAYPAL without returnUrl/cancelUrl', async () => {
      const orderId = await setupOrder();
      const res = await request(server)
        .post(`/v1/orders/${orderId}/payment`)
        .set('Authorization', TOKEN(buyerToken))
        .set('Idempotency-Key', 'pay-paypal-bad')
        .send({ provider: 'PAYPAL' });
      expect(res.status).toBe(400);
    });
  });

  // ----- Refunds -----

  describe('Refund', () => {
    it('admin can refund a SUCCEEDED manual payment', async () => {
      const orderId = await setupOrder();
      const paymentId = await createManualPayment(orderId);
      await request(server)
        .post('/v1/admin/payments/manual-confirm')
        .set('Authorization', TOKEN(adminToken))
        .send({ paymentId })
        .expect(200);

      const refund = await request(server)
        .post(`/v1/admin/payments/${paymentId}/refund`)
        .set('Authorization', TOKEN(adminToken))
        .send({ reason: 'requested by buyer' });
      expect(refund.status).toBe(200);
      expect(refund.body.data.status).toBe('REFUNDED');
    });

    it('cannot refund a PENDING payment', async () => {
      const orderId = await setupOrder();
      const paymentId = await createManualPayment(orderId);
      const res = await request(server)
        .post(`/v1/admin/payments/${paymentId}/refund`)
        .set('Authorization', TOKEN(adminToken))
        .send({});
      expect(res.status).toBe(409);
    });
  });

  // ----- Webhook signature verification -----

  describe('Webhook signatures', () => {
    describe('Stripe', () => {
      it('rejects requests without a signature header', async () => {
        const res = await request(server)
          .post('/v1/internal/stripe/webhook')
          .set('Content-Type', 'application/json')
          .send({ id: 'evt_1', type: 'payment_intent.succeeded' });
        expect(res.status).toBe(401);
      });

      it('rejects requests with a tampered signature', async () => {
        const body = JSON.stringify({ id: 'evt_2', type: 'payment_intent.succeeded' });
        const t = Math.floor(Date.now() / 1000);
        const sig = createHmac('sha256', 'wrong-secret').update(`${t}.${body}`).digest('hex');
        const res = await request(server)
          .post('/v1/internal/stripe/webhook')
          .set('Content-Type', 'application/json')
          .set('Stripe-Signature', `t=${t},v1=${sig}`)
          .send(body);
        expect(res.status).toBe(401);
      });
    });

    describe('Pawapay', () => {
      it('rejects requests without a signature header', async () => {
        const res = await request(server)
          .post('/v1/internal/pawapay/webhook')
          .set('Content-Type', 'application/json')
          .send({ depositId: 'd1', status: 'COMPLETED' });
        expect(res.status).toBe(401);
      });

      it('rejects requests with a tampered signature', async () => {
        const body = JSON.stringify({ depositId: 'd2', status: 'COMPLETED' });
        const res = await request(server)
          .post('/v1/internal/pawapay/webhook')
          .set('Content-Type', 'application/json')
          .set('X-Pawapay-Signature', 'deadbeef'.repeat(8))
          .send(body);
        expect(res.status).toBe(401);
      });

      it('accepts a valid signature and processes an ignored event', async () => {
        // No matching payment in the DB → service logs warn and returns 204.
        const body = JSON.stringify({ depositId: 'unknown-deposit', status: 'COMPLETED', kind: 'DEPOSIT' });
        const sig = createHmac('sha256', PAWAPAY_WEBHOOK_SECRET).update(body).digest('hex');
        const res = await request(server)
          .post('/v1/internal/pawapay/webhook')
          .set('Content-Type', 'application/json')
          .set('X-Pawapay-Signature', sig)
          .send(body);
        expect(res.status).toBe(204);
      });
    });
  });
});

// Silence the unused-var warning for the unused constant (kept for readability).
void STRIPE_WEBHOOK_SECRET;
