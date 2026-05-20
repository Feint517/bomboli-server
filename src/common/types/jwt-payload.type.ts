import { UserRole } from '@common/enums/user-role.enum';

/**
 * Shape of the Supabase-issued (or test-minted) JWT after verification.
 *
 * - `role` is Supabase's own claim — always "authenticated" for signed-in users
 * - `app_role` is the Bomboli-side custom claim that mirrors the local
 *   User.role; we read it as a hint but RolesGuard re-checks against the DB.
 */
export interface JwtPayload {
  sub: string;
  email?: string;
  phone?: string;
  role?: string;
  app_role?: UserRole;
  aud?: string;
  exp?: number;
  iat?: number;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
}
