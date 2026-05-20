import { UserRole } from '@common/enums/user-role.enum';

export interface MeResponseDto {
  id: string;
  supabaseId: string;
  email: string;
  phone: string | null;
  role: UserRole;
  displayName: string | null;
  emailVerifiedAt: string | null;
  phoneVerifiedAt: string | null;
  lastSignInAt: string | null;
  createdAt: string;
  updatedAt: string;
}
