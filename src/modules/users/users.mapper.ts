import { User } from '@prisma/client';

import { UserRole } from '@common/enums/user-role.enum';

import { MeResponseDto } from './dto/me-response.dto';

/**
 * The `defaultLocation` PostGIS column is Unsupported by Prisma — the
 * generated `User` doesn't carry it. Pair the User row with the geo
 * projection from the AddressRepository (or pass a separate { lat, lng }
 * read separately).
 */
export interface UserWithLocation extends User {
  defaultLat?: number | null;
  defaultLng?: number | null;
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
    role: user.role as UserRole,
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
  };
}
