/**
 * Mints a Supabase-compatible HS256 JWT for local testing. The Bomboli server's
 * JwtStrategy validates against SUPABASE_JWT_SECRET + aud=authenticated, so a
 * locally-signed JWT with the right claims passes auth without going through
 * Supabase signup.
 *
 * Usage:
 *   pnpm test:mint-jwt <admin|buyer|seller>
 *
 * The three roles share fixed UUIDs with the seed script (prisma/seed.ts) so
 * the token's `sub` claim resolves to the seeded User row.
 *
 * The token is printed to stdout — pipe it into your curl/HTTPie scripts:
 *   TOKEN=$(pnpm -s test:mint-jwt buyer)
 *   curl -H "Authorization: Bearer $TOKEN" http://localhost:3002/v1/users/me
 *
 * Never use this in production. The IDs are fixed and the script signs against
 * the same JWT secret as Supabase — a leaked token is a real credential for
 * whichever seed user it represents.
 */

import jwt from 'jsonwebtoken';

import { APP_ROLE, TEST_USER_SUPABASE_IDS, TestRole } from './test-user-ids';

function main(): void {
  const role = process.argv[2] as TestRole | undefined;
  if (!role || !(role in TEST_USER_SUPABASE_IDS)) {
    console.error('Usage: pnpm test:mint-jwt <admin|buyer|seller>');
    process.exit(1);
  }

  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) {
    console.error('SUPABASE_JWT_SECRET not set in environment');
    process.exit(1);
  }

  const sub = TEST_USER_SUPABASE_IDS[role];
  const email = `test+${role}@bomboli.test`;

  const token = jwt.sign(
    {
      sub,
      // Supabase's own role claim — always "authenticated" for signed-in users.
      role: 'authenticated',
      aud: 'authenticated',
      email,
      // App-side custom claim read by the Bomboli JwtStrategy. The DB lookup
      // is still the source of truth for role-gated endpoints (RolesGuard).
      app_role: APP_ROLE[role],
    },
    secret,
    { expiresIn: '24h' },
  );

  process.stdout.write(token);
}

main();
