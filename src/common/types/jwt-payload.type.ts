/**
 * Shape of the Supabase-issued (or test-minted) JWT after verification.
 *
 * `role` here is Supabase's own claim — always "authenticated" for
 * signed-in users — not the Bomboli capability layer. App capabilities
 * (admin / seller / deliverer) are read from the local DB by the JWT
 * strategy, never trusted from the token.
 */
export interface JwtPayload {
  sub: string;
  email?: string;
  phone?: string;
  role?: string;
  aud?: string;
  exp?: number;
  iat?: number;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
}
