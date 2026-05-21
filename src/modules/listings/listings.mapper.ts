import { Injectable } from '@nestjs/common';

import { PrismaService } from '@infrastructure/database/prisma.service';

import { ListingResponseDto } from './dto/listing-response.dto';
import { ListingRow } from './listings.repository';

interface SellerLookupRow {
  id: string;
  bannerUrl: string | null;
  user: { displayName: string | null; avatarUrl: string | null } | null;
}

/**
 * Builds the public ListingResponseDto from a Prisma row by attaching the
 * seller summary. `composeMany` batches the seller lookup so a 50-listing
 * search returns in one extra query, not 50.
 */
@Injectable()
export class ListingsMapper {
  constructor(private readonly prisma: PrismaService) {}

  async composeOne(row: ListingRow): Promise<ListingResponseDto> {
    const [composed] = await this.composeMany([row]);
    return composed;
  }

  async composeMany(rows: ListingRow[]): Promise<ListingResponseDto[]> {
    if (rows.length === 0) return [];
    const sellerIds = [...new Set(rows.map((r) => r.sellerId))];
    const sellers = await this.prisma.sellerProfile.findMany({
      where: { id: { in: sellerIds } },
      select: {
        id: true,
        bannerUrl: true,
        user: { select: { displayName: true, avatarUrl: true } },
      },
    });
    const byId = new Map<string, SellerLookupRow>(sellers.map((s) => [s.id, s]));
    return rows.map((row) => this.build(row, byId.get(row.sellerId)));
  }

  private build(row: ListingRow, seller: SellerLookupRow | undefined): ListingResponseDto {
    return {
      id: row.id,
      sellerId: row.sellerId,
      title: row.title,
      description: row.description,
      category: row.category,
      priceCents: row.priceCents,
      currency: row.currency as 'CDF' | 'USD',
      location: { lat: Number(row.lat), lng: Number(row.lng) },
      photos: row.photos,
      options: row.options,
      quantityAvailable: row.quantityAvailable,
      status: row.status,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      seller: seller
        ? {
            id: seller.id,
            displayName: seller.user?.displayName ?? null,
            avatarUrl: seller.user?.avatarUrl ?? null,
            bannerUrl: seller.bannerUrl,
          }
        : null,
    };
  }
}
