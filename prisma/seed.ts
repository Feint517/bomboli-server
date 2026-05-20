import { PrismaClient, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

export const TEST_USERS = [
  {
    supabaseId: '00000000-0000-0000-0000-000000000001',
    email: 'test+admin@bomboli.test',
    role: UserRole.ADMIN,
    displayName: 'Admin Test',
  },
  {
    supabaseId: '00000000-0000-0000-0000-000000000002',
    email: 'test+buyer@bomboli.test',
    role: UserRole.BUYER,
    displayName: 'Buyer Test',
  },
  {
    supabaseId: '00000000-0000-0000-0000-000000000003',
    email: 'test+seller@bomboli.test',
    role: UserRole.SELLER,
    displayName: 'Seller Test',
  },
] as const;

async function main(): Promise<void> {
  const supabaseIds = TEST_USERS.map((u) => u.supabaseId);
  await prisma.user.deleteMany({ where: { supabaseId: { in: supabaseIds } } });

  await prisma.user.createMany({
    data: TEST_USERS.map((u) => ({
      supabaseId: u.supabaseId,
      email: u.email,
      role: u.role,
      displayName: u.displayName,
    })),
  });

  console.info(`Seeded ${TEST_USERS.length} users:`);
  for (const u of TEST_USERS) {
    console.info(`  • ${u.role.padEnd(6)} ${u.email}  (supabaseId=${u.supabaseId})`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
