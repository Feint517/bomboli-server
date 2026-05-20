import { createClient } from '@supabase/supabase-js';

async function main(): Promise<void> {
  const c = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
  const { data, error } = await c.auth.signUp({
    email: `inspect+${Date.now()}@bomboli.test`,
    password: 'Bomboli-pwd-9',
  });
  if (error) {
    console.error(error);
    process.exit(1);
  }
  const token = data.session!.access_token;
  const [header, payload] = token.split('.');
  const headerDecoded = JSON.parse(Buffer.from(header, 'base64url').toString());
  const payloadDecoded = JSON.parse(Buffer.from(payload, 'base64url').toString());
  console.log('header:', JSON.stringify(headerDecoded, null, 2));
  console.log('payload:', JSON.stringify(payloadDecoded, null, 2));
}

main();
