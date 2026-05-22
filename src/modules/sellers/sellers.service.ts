import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '@infrastructure/database/prisma.service';

import { UsersService } from '@modules/users/users.service';

import { SellerProfileResponseDto } from './dto/seller-response.dto';
import { SellerProfileRow, SellersRepository } from './sellers.repository';

export interface UpsertSellerProfileArgs {
  bio?: string | null;
  deliveryRadiusKm?: number;
  availability?: Record<string, string | null> | null;
  languages?: string[];
  pickupPoint?: { lat: number; lng: number } | null;
  promoText?: string | null;
  promoActive?: boolean;
  promoExpiresAt?: Date | null;
}

@Injectable()
export class SellersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly repo: SellersRepository,
  ) {}

  async getPublicProfile(sellerId: string): Promise<SellerProfileResponseDto> {
    const row = await this.repo.findById(sellerId);
    if (!row) throw new NotFoundException('Seller not found');
    return this.composeResponse(row);
  }

  async getMyProfile(actorSupabaseId: string): Promise<SellerProfileResponseDto | null> {
    const user = await this.users.getBySupabaseIdOrFail(actorSupabaseId);
    const row = await this.repo.findByUserId(user.id);
    if (!row) return null;
    return this.composeResponse(row);
  }

  /**
   * Create-or-update the caller's seller profile. The mere presence of a
   * SellerProfile row marks the user as a seller — there's no separate
   * role mutation. A user remains a buyer (can shop, place orders) AND a
   * seller simultaneously.
   */
  async upsertMyProfile(
    actorSupabaseId: string,
    args: UpsertSellerProfileArgs,
  ): Promise<SellerProfileResponseDto> {
    const user = await this.users.getBySupabaseIdOrFail(actorSupabaseId);
    const row = await this.repo.upsert({
      userId: user.id,
      ...args,
    });
    return this.composeResponse(row);
  }

  async setBannerUrl(sellerId: string, url: string): Promise<void> {
    await this.repo.setBannerUrl(sellerId, url);
  }

  async setHeroUrl(sellerId: string, url: string): Promise<void> {
    await this.repo.setHeroUrl(sellerId, url);
  }

  /** Returns the SellerProfile.id for the given user, creating none if absent. */
  async findSellerIdByUserId(userId: string): Promise<string | null> {
    const row = await this.repo.findByUserId(userId);
    return row?.id ?? null;
  }

  private async composeResponse(row: SellerProfileRow): Promise<SellerProfileResponseDto> {
    const [user, verifications, stats] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: row.userId },
        select: { displayName: true, avatarUrl: true },
      }),
      this.prisma.verification.findMany({
        where: { sellerId: row.id },
        orderBy: { kind: 'asc' },
      }),
      this.prisma.sellerStats.findUnique({ where: { sellerId: row.id } }),
    ]);

    const distribution =
      (stats?.distribution as Prisma.JsonObject | null) ?? ({} as Record<string, number>);

    return {
      id: row.id,
      userId: row.userId,
      displayName: user?.displayName ?? null,
      avatarUrl: user?.avatarUrl ?? null,
      bio: row.bio,
      heroUrl: row.heroUrl,
      bannerUrl: row.bannerUrl,
      deliveryRadiusKm: row.deliveryRadiusKm,
      availability: row.availability,
      languages: row.languages,
      pickupPoint:
        row.pickupLat != null && row.pickupLng != null
          ? { lat: Number(row.pickupLat), lng: Number(row.pickupLng) }
          : null,
      promo: row.promoText
        ? {
            text: row.promoText,
            expiresAt: row.promoExpiresAt?.toISOString() ?? null,
          }
        : null,
      verifications: verifications.map((v) => ({
        kind: v.kind,
        status: v.status,
        verifiedAt: v.verifiedAt?.toISOString() ?? null,
      })),
      stats: {
        avgRating: stats?.avgRating ?? 0,
        ratingCount: stats?.ratingCount ?? 0,
        distribution: distribution as Record<string, number>,
        hygieneBar: stats?.hygieneBar ?? 0,
        qualityBar: stats?.qualityBar ?? 0,
        packagingBar: stats?.packagingBar ?? 0,
        topSentimentTags: stats?.topSentimentTags ?? [],
      },
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
