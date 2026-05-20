/**
 * Payload shape sent by Supabase Database Webhooks when subscribed to the
 * `auth.users` table. We only react to INSERT and UPDATE.
 */
export interface SupabaseAuthUserRecord {
  id: string; // uuid — used as supabaseId
  email?: string | null;
  phone?: string | null;
  email_confirmed_at?: string | null;
  phone_confirmed_at?: string | null;
  last_sign_in_at?: string | null;
  raw_user_meta_data?: { displayName?: string; full_name?: string } | null;
}

export interface SupabaseAuthWebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  schema: string;
  record: SupabaseAuthUserRecord | null;
  old_record?: SupabaseAuthUserRecord | null;
}
