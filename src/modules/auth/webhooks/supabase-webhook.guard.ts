import { timingSafeEqual } from 'crypto';

import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';

import { supabaseConfig } from '@config/supabase.config';

import type { Request } from 'express';

/**
 * Validates the shared secret Supabase sends with database webhooks.
 * Configure the webhook in Supabase Studio with:
 *   Authorization: Bearer <SUPABASE_WEBHOOK_SECRET>
 *
 * Uses timing-safe comparison.
 */
@Injectable()
export class SupabaseWebhookGuard implements CanActivate {
  constructor(
    @Inject(supabaseConfig.KEY) private readonly cfg: ConfigType<typeof supabaseConfig>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.cfg.webhookSecret) {
      throw new UnauthorizedException('Webhook secret is not configured');
    }
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing webhook authorization');
    }
    const provided = header.slice('Bearer '.length);
    if (!this.timingSafeEquals(provided, this.cfg.webhookSecret)) {
      throw new UnauthorizedException('Invalid webhook authorization');
    }
    return true;
  }

  private timingSafeEquals(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
  }
}
