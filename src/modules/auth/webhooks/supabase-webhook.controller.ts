import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';

import { Public } from '@common/decorators/public.decorator';

import { UsersService } from '@modules/users/users.service';

import { SupabaseWebhookGuard } from './supabase-webhook.guard';

import type { SupabaseAuthWebhookPayload } from './supabase-webhook.types';

@Controller({ path: 'internal/supabase', version: '1' })
export class SupabaseWebhookController {
  private readonly logger = new Logger(SupabaseWebhookController.name);

  constructor(private readonly users: UsersService) {}

  /**
   * Sink for Supabase Database Webhooks subscribed to `auth.users`. Mirrors
   * INSERT/UPDATE into the local User row. Deletes are ignored for now —
   * we soft-delete via admin action, not via Supabase Auth removal.
   */
  @Public()
  @UseGuards(SupabaseWebhookGuard)
  @Post('auth-hook')
  @HttpCode(HttpStatus.NO_CONTENT)
  async handle(@Body() payload: SupabaseAuthWebhookPayload): Promise<void> {
    if (!payload || typeof payload !== 'object') {
      throw new BadRequestException('Empty webhook payload');
    }
    if (payload.schema !== 'auth' || payload.table !== 'users') {
      // Subscribed to the wrong table — accept silently to avoid Supabase
      // retry storms on a misconfigured hook.
      this.logger.warn(`Ignoring webhook for ${payload.schema}.${payload.table}`);
      return;
    }
    if (payload.type === 'DELETE') {
      return;
    }
    const record = payload.record;
    if (!record?.id || !record.email) {
      throw new BadRequestException('Webhook record missing id or email');
    }
    await this.users.provisionFromSupabase({
      supabaseId: record.id,
      email: record.email,
      phone: record.phone ?? null,
      displayName:
        record.raw_user_meta_data?.displayName ?? record.raw_user_meta_data?.full_name ?? null,
      emailVerifiedAt: parseTimestamp(record.email_confirmed_at),
      phoneVerifiedAt: parseTimestamp(record.phone_confirmed_at),
      lastSignInAt: parseTimestamp(record.last_sign_in_at),
    });
  }
}

function parseTimestamp(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
