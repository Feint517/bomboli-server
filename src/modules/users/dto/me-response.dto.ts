import { UserRole } from '@common/enums/user-role.enum';

export interface MeResponseDto {
  id: string;
  supabaseId: string;
  email: string;
  phone: string | null;
  role: UserRole;
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
}
