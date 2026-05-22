import { User } from '@prisma/client';

import { MeResponseDto } from './dto/me-response.dto';

/**
 * The `defaultLocation` PostGIS column is Unsupported by Prisma — the
 * generated `User` doesn't carry it. Pair the User row with the geo
 * projection + capability flags (sellerProfileId, delivererId) computed
 * via `UsersService.getMeWithLocation`.
 */
export interface UserWithLocation extends User {
  defaultLat?: number | null;
  defaultLng?: number | null;
  sellerProfileId?: string | null;
  delivererId?: string | null;
}

export function toMeResponse(user: UserWithLocation): MeResponseDto {
  const location =
    user.defaultLat != null && user.defaultLng != null
      ? { lat: user.defaultLat, lng: user.defaultLng }
      : null;
  return {
    id: user.id,
    supabaseId: user.supabaseId,
    email: user.email,
    phone: user.phone,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    preferredLanguage: user.preferredLanguage,
    themePref: (user.themePref as 'system' | 'light' | 'dark') ?? 'system',
    defaultLocation: location,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    phoneVerifiedAt: user.phoneVerifiedAt?.toISOString() ?? null,
    lastSignInAt: user.lastSignInAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    isAdmin: user.isAdmin,
    sellerProfileId: user.sellerProfileId ?? null,
    delivererId: user.delivererId ?? null,
  };
}
