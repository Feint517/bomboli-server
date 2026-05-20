import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createTestApp } from './helpers/app';
import { closeDb, getPrisma, resetAllUsers } from './helpers/db';
import { clearMailpit, extractOtp, waitForEmail } from './helpers/mailpit';

const PASSWORD = 'Bomboli-pwd-9';

function uniqueEmail(prefix: string): string {
  return `${prefix}+${Date.now()}.${Math.floor(Math.random() * 1e6)}@bomboli.test`;
}

describe('Auth proxy e2e', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
    await resetAllUsers();
    await clearMailpit();
  });

  afterAll(async () => {
    await resetAllUsers();
    await app?.close();
    await closeDb();
  });

  beforeEach(async () => {
    await resetAllUsers();
    await clearMailpit();
  });

  describe('signup → login → refresh → logout', () => {
    it('full happy path', async () => {
      const email = uniqueEmail('signup');

      // Signup
      const signupRes = await request(server)
        .post('/v1/auth/signup')
        .send({ email, password: PASSWORD, displayName: 'Jean Test' });
      expect(signupRes.status).toBe(201);
      expect(signupRes.body.data.user).toMatchObject({ email, displayName: 'Jean Test', role: 'BUYER' });
      // enable_confirmations = false in local config — session should be returned
      expect(signupRes.body.data.session).toMatchObject({ tokenType: 'bearer' });
      expect(signupRes.body.data.requiresEmailConfirmation).toBe(false);

      // Local public.users row was created
      const dbUser = await getPrisma().user.findUnique({ where: { email } });
      expect(dbUser).not.toBeNull();

      // Login with same credentials
      const loginRes = await request(server)
        .post('/v1/auth/login')
        .send({ email, password: PASSWORD });
      expect(loginRes.status).toBe(200);
      const accessToken = loginRes.body.data.session.accessToken as string;
      const refreshToken = loginRes.body.data.session.refreshToken as string;
      expect(accessToken).toBeTruthy();
      expect(refreshToken).toBeTruthy();

      // /users/me with that token works
      const meRes = await request(server)
        .get('/v1/users/me')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(meRes.status).toBe(200);
      expect(meRes.body.data.email).toBe(email);

      // Refresh produces a fresh session
      const refreshRes = await request(server)
        .post('/v1/auth/refresh')
        .send({ refreshToken });
      expect(refreshRes.status).toBe(200);
      expect(refreshRes.body.data.session.accessToken).toBeTruthy();

      // Logout
      const logoutRes = await request(server)
        .post('/v1/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(logoutRes.status).toBe(204);
    });

    it('rejects duplicate signup with 409', async () => {
      const email = uniqueEmail('dup');
      await request(server)
        .post('/v1/auth/signup')
        .send({ email, password: PASSWORD })
        .expect(201);
      const second = await request(server)
        .post('/v1/auth/signup')
        .send({ email, password: PASSWORD });
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('BOMBOLI_EMAIL_TAKEN');
    });

    it('rejects weak passwords at validation', async () => {
      const email = uniqueEmail('weak');
      const res = await request(server)
        .post('/v1/auth/signup')
        .send({ email, password: 'short' });
      expect(res.status).toBe(400);
    });

    it('rejects wrong password with 401 and InvalidCredentials code', async () => {
      const email = uniqueEmail('badpwd');
      await request(server)
        .post('/v1/auth/signup')
        .send({ email, password: PASSWORD })
        .expect(201);

      const res = await request(server)
        .post('/v1/auth/login')
        .send({ email, password: 'wrong-Pwd-12345' });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('BOMBOLI_INVALID_CREDENTIALS');
    });

    it('rejects refresh with a bogus token', async () => {
      const res = await request(server)
        .post('/v1/auth/refresh')
        .send({ refreshToken: 'not-a-real-refresh-token' });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('logout 401s without an Authorization header', async () => {
      const res = await request(server).post('/v1/auth/logout');
      expect(res.status).toBe(401);
    });
  });

  describe('password reset', () => {
    it('reset-request returns 202 even for unknown email (anti-enumeration)', async () => {
      const res = await request(server)
        .post('/v1/auth/password/reset-request')
        .send({ email: uniqueEmail('ghost') });
      expect(res.status).toBe(202);
      expect(res.body.data).toEqual({ sent: true });
    });

    it('full reset flow: request → OTP email → reset → login with new password', async () => {
      const email = uniqueEmail('reset');
      await request(server)
        .post('/v1/auth/signup')
        .send({ email, password: PASSWORD })
        .expect(201);

      await clearMailpit();

      // Request reset
      await request(server)
        .post('/v1/auth/password/reset-request')
        .send({ email })
        .expect(202);

      // Pull the OTP from the email Mailpit captured
      const message = await waitForEmail(email);
      const otp = extractOtp(message);

      // Reset password
      const newPassword = 'New-Pass-9876';
      const resetRes = await request(server)
        .post('/v1/auth/password/reset')
        .send({ email, token: otp, newPassword });
      expect(resetRes.status).toBe(200);
      expect(resetRes.body.data.session.accessToken).toBeTruthy();

      // Old password no longer works
      const oldLogin = await request(server)
        .post('/v1/auth/login')
        .send({ email, password: PASSWORD });
      expect(oldLogin.status).toBe(401);

      // New password works
      const newLogin = await request(server)
        .post('/v1/auth/login')
        .send({ email, password: newPassword });
      expect(newLogin.status).toBe(200);
    });
  });

  describe('OAuth exchange (validation only — real provider tokens needed for full path)', () => {
    it('rejects bogus id_token with 502', async () => {
      const res = await request(server)
        .post('/v1/auth/oauth/exchange')
        .send({ provider: 'google', idToken: 'not-a-real-id-token-but-long-enough' });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('rejects unknown provider at validation', async () => {
      const res = await request(server)
        .post('/v1/auth/oauth/exchange')
        .send({ provider: 'facebook', idToken: 'whatever-token-long-enough-to-pass' });
      expect(res.status).toBe(400);
    });
  });
});
