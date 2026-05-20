import { PrismaClient } from '@prisma/client';

import { purgeAuthUsers } from './supabase-cleanup';

let prisma: PrismaClient | null = null;

function getPrisma(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}

const SEED_SUPABASE_IDS = [
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000003',
];

/** Wipe any non-seed users + the audit log so tests start clean. */
export async function resetUserTables(): Promise<void> {
  const db = getPrisma();
  await db.user.deleteMany({ where: { supabaseId: { notIn: SEED_SUPABASE_IDS } } });
  await db.auditLog.deleteMany({});
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

export async function closeDb(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
  }
}

export { getPrisma };
