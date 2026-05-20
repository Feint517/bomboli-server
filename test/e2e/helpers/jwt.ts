import jwt from 'jsonwebtoken';

import { TEST_USER_SUPABASE_IDS, TestRole } from '../../../scripts/test-user-ids';

const SECRET = process.env.SUPABASE_JWT_SECRET ?? '';

interface SignOverrides {
  sub?: string;
  email?: string;
  phone?: string;
  aud?: string;
  expiresIn?: string | number;
  algorithm?: jwt.Algorithm;
  secret?: string;
}

export function signSeedToken(role: TestRole, overrides: SignOverrides = {}): string {
  return jwt.sign(
    {
      sub: overrides.sub ?? TEST_USER_SUPABASE_IDS[role],
      role: 'authenticated',
      aud: overrides.aud ?? 'authenticated',
      email: overrides.email ?? `test+${role}@bomboli.test`,
      phone: overrides.phone,
      app_role: role.toUpperCase(),
    },
    overrides.secret ?? SECRET,
    {
      algorithm: overrides.algorithm ?? 'HS256',
      expiresIn: overrides.expiresIn ?? '1h',
    },
  );
}

export function signCustomToken(
  payload: Record<string, unknown>,
  overrides: { secret?: string; algorithm?: jwt.Algorithm; expiresIn?: string | number } = {},
): string {
  return jwt.sign(
    { aud: 'authenticated', role: 'authenticated', ...payload },
    overrides.secret ?? SECRET,
    {
      algorithm: overrides.algorithm ?? 'HS256',
      expiresIn: overrides.expiresIn ?? '1h',
    },
  );
}

export function signExpiredToken(role: TestRole): string {
  // jsonwebtoken's expiresIn doesn't accept negative numbers; sign with a
  // pre-dated iat + a 1s lifespan instead.
  return jwt.sign(
    {
      sub: TEST_USER_SUPABASE_IDS[role],
      role: 'authenticated',
      aud: 'authenticated',
      email: `test+${role}@bomboli.test`,
      iat: Math.floor(Date.now() / 1000) - 3600,
      exp: Math.floor(Date.now() / 1000) - 3000,
    },
    SECRET,
    { algorithm: 'HS256' },
  );
}
