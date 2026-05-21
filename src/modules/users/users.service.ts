import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';

import { PrismaService } from '@infrastructure/database/prisma.service';

import type { UserWithLocation } from './users.mapper';

export interface ProvisionInput {
  supabaseId: string;
  email: string;
  phone?: string | null;
  displayName?: string | null;
  emailVerifiedAt?: Date | null;
  phoneVerifiedAt?: Date | null;
  lastSignInAt?: Date | null;
}

export interface ProfileUpdateInput {
  displayName?: string | null;
  preferredLanguage?: string;
  themePref?: 'system' | 'light' | 'dark';
  avatarUrl?: string | null;
  defaultLocation?: { lat: number; lng: number } | null;
}

const SUPPORTED_LANGUAGES = ['fr', 'en'] as const;
const SUPPORTED_THEMES = ['system', 'light', 'dark'] as const;

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
   * Returns the user along with the lat/lng of their defaultLocation
   * (PostGIS column that Prisma can't project natively).
   */
  async getMeWithLocation(supabaseId: string): Promise<UserWithLocation> {
    const user = await this.getBySupabaseIdOrFail(supabaseId);
    const rows = await this.prisma.$queryRaw<{ lat: number | null; lng: number | null }[]>`
      SELECT
        ST_Y("defaultLocation"::geometry) AS lat,
        ST_X("defaultLocation"::geometry) AS lng
      FROM users
      WHERE id = ${user.id}
    `;
    return { ...user, defaultLat: rows[0]?.lat ?? null, defaultLng: rows[0]?.lng ?? null };
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

  async updateProfile(supabaseId: string, input: ProfileUpdateInput): Promise<UserWithLocation> {
    if (
      input.preferredLanguage &&
      !SUPPORTED_LANGUAGES.includes(input.preferredLanguage as never)
    ) {
      throw new Error(`Unsupported language: ${input.preferredLanguage}`);
    }
    if (input.themePref && !SUPPORTED_THEMES.includes(input.themePref)) {
      throw new Error(`Unsupported theme: ${input.themePref}`);
    }

    const user = await this.getBySupabaseIdOrFail(supabaseId);

    // Standard fields via Prisma.
    const scalarUpdates: Prisma.UserUpdateInput = {};
    if (input.displayName !== undefined) scalarUpdates.displayName = input.displayName;
    if (input.preferredLanguage !== undefined)
      scalarUpdates.preferredLanguage = input.preferredLanguage;
    if (input.themePref !== undefined) scalarUpdates.themePref = input.themePref;
    if (input.avatarUrl !== undefined) scalarUpdates.avatarUrl = input.avatarUrl;
    if (Object.keys(scalarUpdates).length > 0) {
      await this.prisma.user.update({ where: { id: user.id }, data: scalarUpdates });
    }

    // defaultLocation needs raw SQL — `Unsupported` Prisma column.
    if (input.defaultLocation !== undefined) {
      if (input.defaultLocation === null) {
        await this.prisma.$executeRaw`
          UPDATE users SET "defaultLocation" = NULL, "updatedAt" = NOW() WHERE id = ${user.id}
        `;
      } else {
        const { lat, lng } = input.defaultLocation;
        await this.prisma.$executeRaw`
          UPDATE users
          SET "defaultLocation" = ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
              "updatedAt" = NOW()
          WHERE id = ${user.id}
        `;
      }
    }

    return this.getMeWithLocation(supabaseId);
  }
}
