/**
 * Fixed UUIDs for the three seeded test users. Shared between the JWT
 * minting script (scripts/mint-test-jwt.ts) and e2e tests so they all
 * resolve to the same seeded User rows.
 */
export const TEST_USER_SUPABASE_IDS = {
  admin: '00000000-0000-0000-0000-000000000001',
  buyer: '00000000-0000-0000-0000-000000000002',
  seller: '00000000-0000-0000-0000-000000000003',
} as const;

export type TestRole = keyof typeof TEST_USER_SUPABASE_IDS;

export const APP_ROLE: Record<TestRole, 'ADMIN' | 'BUYER' | 'SELLER'> = {
  admin: 'ADMIN',
  buyer: 'BUYER',
  seller: 'SELLER',
};
