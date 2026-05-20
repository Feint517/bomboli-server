import { Body, Controller, HttpCode, HttpStatus, Logger, Post } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';

import { ErrorCodes } from '@common/constants/error-codes.constants';
import { Public } from '@common/decorators/public.decorator';
import { DomainException } from '@common/exceptions/domain.exception';

import { SupabaseAdminService } from '@infrastructure/supabase/supabase-admin.service';

import {
  SendPhoneOtpDto,
  SendPhoneOtpSchema,
  VerifyPhoneOtpDto,
  VerifyPhoneOtpSchema,
} from './dto/phone-otp.dto';

interface SendOtpResponse {
  sent: true;
}

interface VerifyOtpResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * Phone-OTP onboarding. Proxies Supabase Auth so the mobile client doesn't
 * need to know which auth backend we use — it talks to /v1/auth/phone-otp/*
 * and Bomboli abstracts the rest. The actual user provisioning into the
 * local DB happens via the auth webhook on user.created.
 */
@Controller({ path: 'auth/phone-otp', version: '1' })
export class PhoneOtpController {
  private readonly logger = new Logger(PhoneOtpController.name);

  constructor(private readonly admin: SupabaseAdminService) {}

  @Public()
  @Post('send')
  @HttpCode(HttpStatus.ACCEPTED)
  async send(
    @Body(new ZodValidationPipe(SendPhoneOtpSchema)) dto: SendPhoneOtpDto,
  ): Promise<SendOtpResponse> {
    const { error } = await this.admin.client.auth.signInWithOtp({
      phone: dto.phone,
    });
    if (error) {
      this.logger.warn(`Phone OTP send failed for ${dto.phone}: ${error.message}`);
      throw new DomainException(
        ErrorCodes.Unknown,
        "Impossible d'envoyer le code de vérification. Veuillez réessayer.",
      );
    }
    return { sent: true };
  }

  @Public()
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  async verify(
    @Body(new ZodValidationPipe(VerifyPhoneOtpSchema)) dto: VerifyPhoneOtpDto,
  ): Promise<VerifyOtpResponse> {
    const { data, error } = await this.admin.client.auth.verifyOtp({
      phone: dto.phone,
      token: dto.token,
      type: 'sms',
    });
    if (error || !data?.session) {
      this.logger.warn(
        `Phone OTP verify failed for ${dto.phone}: ${error?.message ?? 'no session'}`,
      );
      throw new DomainException(
        ErrorCodes.InvalidToken,
        'Code de vérification invalide ou expiré.',
      );
    }
    return {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresIn: data.session.expires_in,
    };
  }
}
