import { User } from '@prisma/client';

import { UserRole } from '@common/enums/user-role.enum';

import { MeResponseDto } from './dto/me-response.dto';

export function toMeResponse(user: User): MeResponseDto {
  return {
    id: user.id,
    supabaseId: user.supabaseId,
    email: user.email,
    phone: user.phone,
    role: user.role as UserRole,
    displayName: user.displayName,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    phoneVerifiedAt: user.phoneVerifiedAt?.toISOString() ?? null,
    lastSignInAt: user.lastSignInAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}
