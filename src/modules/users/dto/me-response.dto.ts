/**
 * The canonical "who am I" response shape. Returned by GET /v1/users/me
 * and embedded in every auth-flow response.
 *
 * Capability model:
 *   - Every authenticated user is implicitly a **buyer** — no flag, just
 *     authentication.
 *   - `isAdmin: true` → escalated admin privileges (gates `/v1/admin/*`).
 *   - `sellerProfileId: string | null` → present iff the user has opened
 *     a seller profile via `PUT /v1/sellers/me/profile`.
 *   - `delivererId: string | null` → present iff the user has been
 *     onboarded as a delivery partner by an admin.
 *
 * All three capabilities are additive: a user can be a buyer + seller +
 * deliverer + admin simultaneously. The client uses these fields to
 * decide which UI surfaces to render.
 */
export interface MeResponseDto {
  id: string;
  supabaseId: string;
  email: string;
  phone: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  preferredLanguage: string;
  themePref: 'system' | 'light' | 'dark';
  defaultLocation: { lat: number; lng: number } | null;
  emailVerifiedAt: string | null;
  phoneVerifiedAt: string | null;
  lastSignInAt: string | null;
  createdAt: string;
  updatedAt: string;

  isAdmin: boolean;
  sellerProfileId: string | null;
  delivererId: string | null;
}
