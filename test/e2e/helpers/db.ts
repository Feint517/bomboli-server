import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

import { purgeAuthUsers } from './supabase-cleanup';

let prisma: PrismaClient | null = null;
let redis: Redis | null = null;

function getPrisma(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6381', {
      maxRetriesPerRequest: 1,
      lazyConnect: false,
    });
  }
  return redis;
}

const SEED_SUPABASE_IDS = [
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000003',
];

/**
 * Canonical seed state. Restored after every test so tests don't see leaked
 * mutations from previous runs. Mirrors prisma/seed.ts.
 */
const SEED_USERS = [
  {
    supabaseId: '00000000-0000-0000-0000-000000000001',
    email: 'test+admin@bomboli.test',
    role: 'ADMIN' as const,
    displayName: 'Admin Test',
  },
  {
    supabaseId: '00000000-0000-0000-0000-000000000002',
    email: 'test+buyer@bomboli.test',
    role: 'BUYER' as const,
    displayName: 'Buyer Test',
  },
  {
    supabaseId: '00000000-0000-0000-0000-000000000003',
    email: 'test+seller@bomboli.test',
    role: 'SELLER' as const,
    displayName: 'Seller Test',
  },
];

/**
 * Hard reset: wipes every test-created row and restores the three seed
 * users to canonical state. Call from beforeEach in any test suite.
 *
 * Cascades through FKs:
 *   user → seller_profile → listings/verifications/seller_stats
 *   user → addresses
 *   user → devices
 */
export async function resetUserTables(): Promise<void> {
  const db = getPrisma();

  // Order matters because of RESTRICT FKs:
  //   orders.sellerId → seller_profiles (RESTRICT)
  //   orders.buyerId  → users           (RESTRICT)
  // So we must delete orders before sellers/users.

  // 1. Orders + carts for ALL users (test-created and seed). Cascade clears
  //    order_items and cart_items via FK.
  await db.order.deleteMany({});
  await db.cart.deleteMany({});

  // 2. Non-seed users (cascades to seller profiles, listings, addresses,
  //    devices for those users via FK).
  await db.user.deleteMany({ where: { supabaseId: { notIn: SEED_SUPABASE_IDS } } });

  // 3. Seed users' derived data (seed users themselves stay).
  await Promise.all([
    db.sellerProfile.deleteMany({ where: { user: { supabaseId: { in: SEED_SUPABASE_IDS } } } }),
    db.address.deleteMany({ where: { user: { supabaseId: { in: SEED_SUPABASE_IDS } } } }),
    db.device.deleteMany({ where: { user: { supabaseId: { in: SEED_SUPABASE_IDS } } } }),
  ]);
  // Restore seed users' profile fields to canonical values.
  await Promise.all(
    SEED_USERS.map((u) =>
      db.user.update({
        where: { supabaseId: u.supabaseId },
        data: {
          email: u.email,
          role: u.role,
          displayName: u.displayName,
          avatarUrl: null,
          preferredLanguage: 'fr',
          themePref: 'system',
        },
      }),
    ),
  );
  // Clear defaultLocation via raw SQL (Unsupported column).
  await db.$executeRaw`
    UPDATE users SET "defaultLocation" = NULL
    WHERE "supabaseId" IN (${SEED_SUPABASE_IDS[0]}, ${SEED_SUPABASE_IDS[1]}, ${SEED_SUPABASE_IDS[2]})
  `;
  await db.auditLog.deleteMany({});

  // Clear Redis state: recently-viewed sets per seed user, plus every
  // idempotency cache entry (keyed by Supabase id, prefix `idem:*`).
  const r = getRedis();
  const seedUserIds = await db.user.findMany({
    where: { supabaseId: { in: SEED_SUPABASE_IDS } },
    select: { id: true },
  });
  await Promise.all(seedUserIds.map((u) => r.del(`rv:${u.id}`)));
  const idemKeys = await r.keys('idem:*');
  if (idemKeys.length > 0) await r.del(...idemKeys);
}

/**
 * Wipes both public.users and auth.users of non-seed entries. Use this in
 * suites that exercise real Supabase signups so leftover auth rows don't
 * collide across runs.
 */
export async function resetAllUsers(): Promise<void> {
  await purgeAuthUsers();
  await resetUserTables();
}

/** Backwards-compatible alias — kept for explicit catalog-cleanup intent. */
export async function resetCatalog(): Promise<void> {
  await resetUserTables();
}

export async function closeDb(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
  }
  if (redis) {
    await redis.quit();
    redis = null;
  }
}

export { getPrisma };
