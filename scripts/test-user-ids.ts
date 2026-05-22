/**
 * Fixed UUIDs for the three seeded test users. Shared between the JWT
 * minting script (scripts/mint-test-jwt.ts) and e2e tests so they all
 * resolve to the same seeded User rows.
 *
 * Note: "admin" / "buyer" / "seller" here are just **identifiers** for the
 * three seeded users — they don't encode capability anymore. The "admin"
 * seed user has `isAdmin = true`; the others are regular users (any user
 * can become a seller / deliverer by creating the corresponding profile).
 */
export const TEST_USER_SUPABASE_IDS = {
  admin: '00000000-0000-0000-0000-000000000001',
  buyer: '00000000-0000-0000-0000-000000000002',
  seller: '00000000-0000-0000-0000-000000000003',
} as const;

export type TestRole = keyof typeof TEST_USER_SUPABASE_IDS;
