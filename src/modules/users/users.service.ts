import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';

import { PrismaService } from '@infrastructure/database/prisma.service';

export interface ProvisionInput {
  supabaseId: string;
  email: string;
  phone?: string | null;
  displayName?: string | null;
  emailVerifiedAt?: Date | null;
  phoneVerifiedAt?: Date | null;
  lastSignInAt?: Date | null;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly prisma: PrismaService) {}

  findBySupabaseId(supabaseId: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { supabaseId } });
  }

  async getBySupabaseIdOrFail(supabaseId: string): Promise<User> {
    const user = await this.findBySupabaseId(supabaseId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  /**
   * Idempotent upsert keyed by `supabaseId`. Called by:
   *   - the Supabase Auth webhook on user.created / user.updated (carries
   *     the verification timestamps),
   *   - the JwtStrategy as a JIT fallback when the webhook hasn't caught up
   *     (no verification info available — webhook will fill it in later).
   *
   * Email collisions (P2002 on the `email` unique index) are surfaced to
   * the caller — they mean two different Supabase IDs claim the same email,
   * which is a data integrity issue worth flagging.
   */
  async provisionFromSupabase(input: ProvisionInput): Promise<User> {
    const data: Prisma.UserCreateInput = {
      supabaseId: input.supabaseId,
      email: input.email.toLowerCase(),
      phone: input.phone ?? null,
      displayName: input.displayName ?? null,
      emailVerifiedAt: input.emailVerifiedAt ?? null,
      phoneVerifiedAt: input.phoneVerifiedAt ?? null,
      lastSignInAt: input.lastSignInAt ?? null,
    };
    // Only overwrite fields that are explicitly present in the input. The JIT
    // path doesn't have verification timestamps, and we don't want it to clear
    // values previously set by the webhook.
    const updateData: Prisma.UserUpdateInput = {
      email: data.email,
      phone: data.phone,
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(input.emailVerifiedAt !== undefined ? { emailVerifiedAt: input.emailVerifiedAt } : {}),
      ...(input.phoneVerifiedAt !== undefined ? { phoneVerifiedAt: input.phoneVerifiedAt } : {}),
      ...(input.lastSignInAt !== undefined ? { lastSignInAt: input.lastSignInAt } : {}),
    };
    const user = await this.prisma.user.upsert({
      where: { supabaseId: input.supabaseId },
      create: data,
      update: updateData,
    });
    this.logger.debug(`Provisioned user ${user.id} (supabaseId=${input.supabaseId})`);
    return user;
  }
}
