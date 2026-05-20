import type { MeResponseDto } from '@modules/users/dto/me-response.dto';

export interface SessionDto {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  expiresAt: number; // unix seconds
  tokenType: 'bearer';
}

export interface AuthSessionResponseDto {
  session: SessionDto;
  user: MeResponseDto;
}

/**
 * Signup may not return a session when email confirmation is required —
 * the client must call email/verify afterward to get one.
 */
export interface SignupResponseDto {
  user: MeResponseDto;
  session: SessionDto | null;
  requiresEmailConfirmation: boolean;
}
