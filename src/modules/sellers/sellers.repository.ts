import { Injectable } from '@nestjs/common';
import { Prisma, SellerProfile } from '@prisma/client';
import { ulid } from 'ulid';

import { PrismaService } from '@infrastructure/database/prisma.service';

export interface SellerProfileRow {
  id: string;
  userId: string;
  bio: string | null;
  heroUrl: string | null;
  bannerUrl: string | null;
  deliveryRadiusKm: number;
  availability: Record<string, string | null> | null;
  languages: string[];
  pickupLat: number | null;
  pickupLng: number | null;
  promoText: string | null;
  promoActive: boolean;
  promoExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface UpsertInput {
  userId: string;
  bio?: string | null;
  deliveryRadiusKm?: number;
  availability?: Record<string, string | null> | null;
  languages?: string[];
  pickupPoint?: { lat: number; lng: number } | null;
  promoText?: string | null;
  promoActive?: boolean;
  promoExpiresAt?: Date | null;
}

const SELECT_COLUMNS = Prisma.sql`
  id, "userId", bio, "heroUrl", "bannerUrl", "deliveryRadiusKm",
  availability, languages,
  ST_Y("pickupPoint"::geometry) AS "pickupLat",
  ST_X("pickupPoint"::geometry) AS "pickupLng",
  "promoText", "promoActive", "promoExpiresAt",
  "createdAt", "updatedAt"
`;

@Injectable()
export class SellersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByUserId(userId: string): Promise<SellerProfileRow | null> {
    const rows = await this.prisma.$queryRaw<SellerProfileRow[]>(Prisma.sql`
      SELECT ${SELECT_COLUMNS} FROM seller_profiles WHERE "userId" = ${userId} LIMIT 1
    `);
    return rows[0] ?? null;
  }

  async findById(id: string): Promise<SellerProfileRow | null> {
    const rows = await this.prisma.$queryRaw<SellerProfileRow[]>(Prisma.sql`
      SELECT ${SELECT_COLUMNS} FROM seller_profiles WHERE id = ${id} LIMIT 1
    `);
    return rows[0] ?? null;
  }

  /**
   * Upsert keyed by userId. Returns the row (with decoded lat/lng for
   * pickupPoint). PostGIS columns require raw SQL; everything else could
   * be done via Prisma, but doing it all here keeps the contract single-shot.
   */
  async upsert(input: UpsertInput): Promise<SellerProfileRow> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.sellerProfile.findUnique({ where: { userId: input.userId } });
      const id = existing?.id ?? ulid();

      if (!existing) {
        await tx.$executeRaw`
          INSERT INTO seller_profiles (id, "userId", "createdAt", "updatedAt")
          VALUES (${id}, ${input.userId}, NOW(), NOW())
        `;
        // Stats row ships with default zeros so reads have something to return.
        await tx.$executeRaw`
          INSERT INTO seller_stats ("sellerId", "updatedAt")
          VALUES (${id}, NOW())
          ON CONFLICT ("sellerId") DO NOTHING
        `;
      }

      const sets: Prisma.Sql[] = [Prisma.sql`"updatedAt" = NOW()`];
      if (input.bio !== undefined) sets.push(Prisma.sql`bio = ${input.bio}`);
      if (input.deliveryRadiusKm !== undefined) {
        sets.push(Prisma.sql`"deliveryRadiusKm" = ${input.deliveryRadiusKm}`);
      }
      if (input.availability !== undefined) {
        sets.push(
          Prisma.sql`availability = ${
            input.availability ? JSON.stringify(input.availability) : null
          }::jsonb`,
        );
      }
      if (input.languages !== undefined) {
        sets.push(Prisma.sql`languages = ${input.languages}::text[]`);
      }
      if (input.pickupPoint !== undefined) {
        sets.push(
          input.pickupPoint === null
            ? Prisma.sql`"pickupPoint" = NULL`
            : Prisma.sql`"pickupPoint" = ST_SetSRID(ST_MakePoint(${input.pickupPoint.lng}, ${input.pickupPoint.lat}), 4326)::geography`,
        );
      }
      if (input.promoText !== undefined) sets.push(Prisma.sql`"promoText" = ${input.promoText}`);
      if (input.promoActive !== undefined)
        sets.push(Prisma.sql`"promoActive" = ${input.promoActive}`);
      if (input.promoExpiresAt !== undefined) {
        sets.push(Prisma.sql`"promoExpiresAt" = ${input.promoExpiresAt}`);
      }
      if (sets.length > 1) {
        await tx.$executeRaw(
          Prisma.sql`UPDATE seller_profiles SET ${Prisma.join(sets, ', ')} WHERE id = ${id}`,
        );
      }

      const rows = await tx.$queryRaw<SellerProfileRow[]>(Prisma.sql`
        SELECT ${SELECT_COLUMNS} FROM seller_profiles WHERE id = ${id}
      `);
      return rows[0]!;
    });
  }

  setBannerUrl(id: string, url: string): Promise<SellerProfile> {
    return this.prisma.sellerProfile.update({
      where: { id },
      data: { bannerUrl: url },
    });
  }

  setHeroUrl(id: string, url: string): Promise<SellerProfile> {
    return this.prisma.sellerProfile.update({
      where: { id },
      data: { heroUrl: url },
    });
  }
}
