import { createClient } from '@supabase/supabase-js';

const SEED_SUPABASE_IDS = new Set([
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000003',
]);

let cached: ReturnType<typeof createClient> | null = null;

function client() {
  if (!cached) {
    cached = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}

/**
 * Removes all non-seed users from auth.users. Used between e2e files so
 * signups in one suite don't conflict with another. The seeded test users
 * (the three fixed UUIDs) are preserved.
 */
export async function purgeAuthUsers(): Promise<void> {
  const c = client();
  // listUsers paginates; loop until empty page.
  let page = 1;
  for (;;) {
    const { data, error } = await c.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const users = data.users ?? [];
    if (users.length === 0) break;
    for (const user of users) {
      if (!SEED_SUPABASE_IDS.has(user.id)) {
        await c.auth.admin.deleteUser(user.id);
      }
    }
    if (users.length < 100) break;
    page += 1;
  }
}
