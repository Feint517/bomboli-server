import {
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';

import { ErrorCodes } from '@common/constants/error-codes.constants';
import { DomainException } from '@common/exceptions/domain.exception';

import { SupabaseAdminService } from '@infrastructure/supabase/supabase-admin.service';
import { SupabaseService } from '@infrastructure/supabase/supabase.service';

import { toMeResponse } from '@modules/users/users.mapper';
import { UsersService } from '@modules/users/users.service';
import { MailService } from '@modules/mail/mail.service';

import { AuthSessionResponseDto, SessionDto, SignupResponseDto } from './dto/auth-response.dto';

import type { AuthError, Session, User as SupabaseUser } from '@supabase/supabase-js';

interface SignupArgs {
  email: string;
  password: string;
  displayName?: string;
  phone?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly anon: SupabaseService,
    private readonly admin: SupabaseAdminService,
    private readonly users: UsersService,
    private readonly mail: MailService,

  ) {}

async signup(args: SignupArgs): Promise<SignupResponseDto> {
  const email = args.email.trim().toLowerCase();

  const { data, error } = await this.admin.client.auth.admin.generateLink({
    type: 'signup',
    email,
    password: args.password,
    options: {
      data: args.displayName ? { displayName: args.displayName } : undefined,
    },
  });

  if (error || !data.user) {
    throw this.mapAuthError(error, 'signup');
  }

  const token = data.properties?.email_otp ?? null;

  if (!token) {
    this.logger.warn(`Signup verification token missing for ${email}`);

    throw new InternalServerErrorException(
      'Could not generate email verification code',
    );
  }

  const user = await this.users.provisionFromSupabase({
    supabaseId: data.user.id,
    email: data.user.email ?? email,
    phone: args.phone?.trim() || null,
    displayName: args.displayName ?? null,
    emailVerifiedAt: null,
    phoneVerifiedAt: null,
    lastSignInAt: null,
  });

await this.mail.sendEmailVerification(email, token);
  return {
    user: toMeResponse(user),
    session: null,
    requiresEmailConfirmation: true,
  };
}

  async loginWithPassword(email: string, password: string): Promise<AuthSessionResponseDto> {
    const { data, error } = await this.anon.client.auth.signInWithPassword({ email, password });
    if (error || !data.user || !data.session) {
      throw this.mapAuthError(error, 'login');
    }
    return this.materialize(data.user, data.session);
  }

  async refresh(refreshToken: string): Promise<AuthSessionResponseDto> {
    const { data, error } = await this.anon.client.auth.refreshSession({
      refresh_token: refreshToken,
    });
    if (error || !data.user || !data.session) {
      throw this.mapAuthError(error, 'refresh');
    }
    return this.materialize(data.user, data.session);
  }

  /**
   * Best-effort server-side revocation of the user's refresh tokens. Failures
   * are logged but not thrown — the client should always discard tokens
   * regardless.
   */
  async logout(accessToken: string): Promise<void> {
    try {
      const { error } = await this.admin.client.auth.admin.signOut(accessToken, 'global');
      if (error) {
        this.logger.warn(`Sign-out call returned error: ${error.message}`);
      }
    } catch (err) {
      this.logger.warn(`Sign-out call threw: ${(err as Error).message}`);
    }
  }

  async verifyEmailOtp(email: string, token: string): Promise<AuthSessionResponseDto> {
    const { data, error } = await this.anon.client.auth.verifyOtp({
      email,
      token,
      type: 'signup',
    });
    if (error || !data.user || !data.session) {
      throw this.mapAuthError(error, 'verify-email');
    }
    return this.materialize(data.user, data.session);
  }

  async resendVerification(email: string): Promise<void> {
    const { error } = await this.anon.client.auth.resend({ email, type: 'signup' });
    if (error) {
      // Don't reveal whether the email exists, but DO surface rate-limit hits
      // so the client can show "please wait" rather than a generic error.
      if (this.isRateLimit(error)) {
        throw new DomainException(
          ErrorCodes.RateLimited,
          'Trop de tentatives. Réessayez dans quelques minutes.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      this.logger.warn(`Resend verification failed for ${email}: ${error.message}`);
    }
  }

  /**
   * Sends a password-reset email. Always returns success — we don't reveal
   * whether the email is registered (anti-enumeration).
   */
async requestPasswordReset(email: string): Promise<void> {
  const { data, error } = await this.admin.client.auth.admin.generateLink({
    type: 'recovery',
    email,
  });

  if (error) {
    this.logger.warn(`Password reset link generation failed for ${email}: ${error.message}`);
    return;
  }

  const token =
    data.properties?.email_otp ??
    data.properties?.hashed_token ??
    null;

  if (!token) {
    this.logger.warn(`Password reset token missing for ${email}`);
    return;
  }

  await this.mail.sendPasswordResetEmail(email, token);
}

  /**
   * Two-step: verify the recovery OTP to obtain a session, then update the
   * password via the admin SDK (anon client is stateless and updateUser
   * needs an active session in client memory, which we don't keep).
   */
  async resetPassword(
    email: string,
    token: string,
    newPassword: string,
  ): Promise<AuthSessionResponseDto> {
    const { data: vData, error: vErr } = await this.anon.client.auth.verifyOtp({
      email,
      token,
      type: 'recovery',
    });
    if (vErr || !vData.user || !vData.session) {
      throw this.mapAuthError(vErr, 'reset-password');
    }
    const { error: uErr } = await this.admin.client.auth.admin.updateUserById(vData.user.id, {
      password: newPassword,
    });
    if (uErr) {
      throw this.mapAuthError(uErr, 'reset-password');
    }
    return this.materialize(vData.user, vData.session);
  }

  async exchangeOAuthIdToken(
    provider: 'google' | 'apple',
    idToken: string,
    nonce?: string,
    accessToken?: string,
  ): Promise<AuthSessionResponseDto> {
    const { data, error } = await this.anon.client.auth.signInWithIdToken({
      provider,
      token: idToken,
      access_token: accessToken,
      nonce,
    });
    if (error || !data.user || !data.session) {
      throw this.mapAuthError(error, 'oauth-exchange');
    }
    return this.materialize(data.user, data.session);
  }

  private async materialize(
    supabaseUser: SupabaseUser,
    session: Session,
  ): Promise<AuthSessionResponseDto> {
    const user = await this.users.provisionFromSupabase({
      supabaseId: supabaseUser.id,
      email: supabaseUser.email ?? '',
      phone: supabaseUser.phone?.trim() || null,
      emailVerifiedAt: parseTs(supabaseUser.email_confirmed_at),
      phoneVerifiedAt: parseTs(supabaseUser.phone_confirmed_at),
      lastSignInAt: parseTs(supabaseUser.last_sign_in_at) ?? new Date(),
    });
    return { user: toMeResponse(user), session: toSession(session) };
  }

  private mapAuthError(error: AuthError | null, context: string): DomainException {
    const message = error?.message?.toLowerCase() ?? '';
    if (message.includes('already registered') || message.includes('user already exists')) {
      return new DomainException(
        ErrorCodes.EmailTaken,
        'Un compte avec cet email existe déjà.',
        HttpStatus.CONFLICT,
      );
    }
    if (message.includes('invalid login credentials') || message.includes('invalid_credentials')) {
      return new DomainException(
        ErrorCodes.InvalidCredentials,
        'Email ou mot de passe incorrect.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (message.includes('email not confirmed')) {
      return new DomainException(
        ErrorCodes.EmailNotVerified,
        'Veuillez vérifier votre email avant de vous connecter.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (
      message.includes('token has expired') ||
      message.includes('invalid token') ||
      message.includes('expired')
    ) {
      return new DomainException(
        ErrorCodes.InvalidOtp,
        'Code invalide ou expiré.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (message.includes('password should be')) {
      return new DomainException(
        ErrorCodes.PasswordTooWeak,
        'Mot de passe trop faible.',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (this.isRateLimit(error)) {
      return new DomainException(
        ErrorCodes.RateLimited,
        'Trop de tentatives. Veuillez patienter quelques instants.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.logger.warn(`Auth ${context} unmapped error: ${error?.message ?? 'unknown'}`);
    return new DomainException(
      ErrorCodes.AuthProviderError,
      "Une erreur est survenue lors de l'authentification. Veuillez réessayer.",
      HttpStatus.BAD_GATEWAY,
    );
  }

  private isRateLimit(error: AuthError | null): boolean {
    if (!error) return false;
    const message = error.message?.toLowerCase() ?? '';
    return message.includes('rate limit') || message.includes('too many');
  }
}

function parseTs(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toSession(session: Session): SessionDto {
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresIn: session.expires_in,
    expiresAt: session.expires_at ?? Math.floor(Date.now() / 1000) + session.expires_in,
    tokenType: 'bearer',
  };
}
