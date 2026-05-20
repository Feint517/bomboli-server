import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';

import { Public } from '@common/decorators/public.decorator';

import { AuthService } from './auth.service';
import { AuthSessionResponseDto, SignupResponseDto } from './dto/auth-response.dto';
import {
  LoginDto,
  LoginSchema,
  OAuthExchangeDto,
  OAuthExchangeSchema,
  PasswordResetDto,
  PasswordResetRequestDto,
  PasswordResetRequestSchema,
  PasswordResetSchema,
  RefreshDto,
  RefreshSchema,
  ResendVerificationDto,
  ResendVerificationSchema,
  SignupDto,
  SignupSchema,
  VerifyEmailDto,
  VerifyEmailSchema,
} from './dto/auth.dto';

@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('signup')
  @HttpCode(HttpStatus.CREATED)
  signup(@Body(new ZodValidationPipe(SignupSchema)) dto: SignupDto): Promise<SignupResponseDto> {
    return this.auth.signup(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body(new ZodValidationPipe(LoginSchema)) dto: LoginDto): Promise<AuthSessionResponseDto> {
    return this.auth.loginWithPassword(dto.email, dto.password);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(
    @Body(new ZodValidationPipe(RefreshSchema)) dto: RefreshDto,
  ): Promise<AuthSessionResponseDto> {
    return this.auth.refresh(dto.refreshToken);
  }

  /** Requires the access token in `Authorization: Bearer ...`. */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Headers('authorization') authHeader: string | undefined): Promise<void> {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing access token');
    }
    const token = authHeader.slice('Bearer '.length);
    await this.auth.logout(token);
  }

  @Public()
  @Post('email/verify')
  @HttpCode(HttpStatus.OK)
  verifyEmail(
    @Body(new ZodValidationPipe(VerifyEmailSchema)) dto: VerifyEmailDto,
  ): Promise<AuthSessionResponseDto> {
    return this.auth.verifyEmailOtp(dto.email, dto.token);
  }

  @Public()
  @Post('email/resend-verification')
  @HttpCode(HttpStatus.ACCEPTED)
  async resendVerification(
    @Body(new ZodValidationPipe(ResendVerificationSchema)) dto: ResendVerificationDto,
  ): Promise<{ sent: true }> {
    await this.auth.resendVerification(dto.email);
    return { sent: true };
  }

  @Public()
  @Post('password/reset-request')
  @HttpCode(HttpStatus.ACCEPTED)
  async requestPasswordReset(
    @Body(new ZodValidationPipe(PasswordResetRequestSchema)) dto: PasswordResetRequestDto,
  ): Promise<{ sent: true }> {
    await this.auth.requestPasswordReset(dto.email);
    return { sent: true };
  }

  @Public()
  @Post('password/reset')
  @HttpCode(HttpStatus.OK)
  resetPassword(
    @Body(new ZodValidationPipe(PasswordResetSchema)) dto: PasswordResetDto,
  ): Promise<AuthSessionResponseDto> {
    return this.auth.resetPassword(dto.email, dto.token, dto.newPassword);
  }

  /**
   * OAuth code/id_token exchange. The mobile client uses the native OAuth
   * SDKs (Google Sign In, Sign In with Apple), obtains an id_token, and
   * exchanges it here for a Supabase session.
   */
  @Public()
  @Post('oauth/exchange')
  @HttpCode(HttpStatus.OK)
  oauthExchange(
    @Body(new ZodValidationPipe(OAuthExchangeSchema)) dto: OAuthExchangeDto,
  ): Promise<AuthSessionResponseDto> {
    return this.auth.exchangeOAuthIdToken(dto.provider, dto.idToken, dto.nonce, dto.accessToken);
  }
}
