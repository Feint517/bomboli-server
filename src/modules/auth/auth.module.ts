import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';

import { supabaseConfig } from '@config/supabase.config';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PhoneOtpController } from './phone-otp.controller';
import { SupabaseJwtStrategy } from './strategies/supabase-jwt.strategy';
import { SupabaseWebhookController } from './webhooks/supabase-webhook.controller';
import { SupabaseWebhookGuard } from './webhooks/supabase-webhook.guard';

@Module({
  imports: [
    ConfigModule.forFeature(supabaseConfig),
    PassportModule.register({ defaultStrategy: 'jwt' }),
  ],
  controllers: [AuthController, PhoneOtpController, SupabaseWebhookController],
  providers: [AuthService, SupabaseJwtStrategy, SupabaseWebhookGuard],
  exports: [PassportModule, AuthService],
})
export class AuthModule {}
