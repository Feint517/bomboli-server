import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { categoryRadiusMetersSql, ListingCategory } from '@common/geo/category-caps';

import { PrismaService } from '@infrastructure/database/prisma.service';

import { ListingRow } from '@modules/listings/listings.repository';

import { SortOption } from './dto/search.dto';

export interface SearchInput {
  q?: string;
  category?: ListingCategory;
  maxDistanceKm?: number;
  lat?: number;
  lng?: number;
  sort?: SortOption;
  offset: number;
  limit: number;
}

const LISTING_COLUMNS = Prisma.sql`
  l.id, l."sellerId", l.title, l.description, l.category,
  l."priceCents", l.currency,
  ST_Y(l.location::geometry) AS lat,
  ST_X(l.location::geometry) AS lng,
  l.photos, l.options, l."quantityAvailable", l.status,
  l."expiresAt", l."publishedAt", l."deletedAt", l."createdAt", l."updatedAt"
`;

const PUBLIC_FILTER = Prisma.sql`
  l.status = 'PUBLISHED'::"ListingStatus"
  AND l."deletedAt" IS NULL
  AND (l."expiresAt" IS NULL OR l."expiresAt" > NOW())
`;

@Injectable()
export class DiscoveryRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ------------------- Search -------------------

  async search(input: SearchInput): Promise<{ rows: ListingRow[]; total: number }> {
    const conditions: Prisma.Sql[] = [PUBLIC_FILTER];

    // Full-text + fuzzy fallback.
    const hasQuery = Boolean(input.q && input.q.length > 0);
    if (hasQuery) {
      conditions.push(
        Prisma.sql`(
          l."searchVector" @@ websearch_to_tsquery('french', ${input.q!})
          OR similarity(l.title, ${input.q!}) > 0.25
        )`,
      );
    }

    if (input.category) {
      conditions.push(Prisma.sql`l.category = ${input.category}::"ListingCategory"`);
    }

    // Geo filter: explicit radius (capped at the global max 30km) AND
    // per-category cap so a "Seconde main" 30km away never appears.
    const hasGeo = input.lat !== undefined && input.lng !== undefined;
    if (hasGeo) {
      const point = Prisma.sql`ST_SetSRID(ST_MakePoint(${input.lng}, ${input.lat}), 4326)::geography`;
      const requestedMeters = (input.maxDistanceKm ?? 30) * 1000;
      conditions.push(
        Prisma.sql`ST_DWithin(l.location, ${point}, LEAST(${requestedMeters}::float, ${Prisma.raw(categoryRadiusMetersSql('l'))}))`,
      );
    }

    const whereSql = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;

    // Sort. Default to relevance if a query is provided, else newest.
    const sort = input.sort ?? (hasQuery ? 'relevance' : 'newest');
    const orderSql = this.orderClause(sort, input);

    const rowsPromise = this.prisma.$queryRaw<ListingRow[]>(Prisma.sql`
      SELECT ${LISTING_COLUMNS}
      FROM listings l
      ${whereSql}
      ${orderSql}
      LIMIT ${input.limit}
      OFFSET ${input.offset}
    `);
    const countPromise = this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
      SELECT COUNT(*) AS count FROM listings l ${whereSql}
    `);

    const [rows, countRows] = await Promise.all([rowsPromise, countPromise]);
    return { rows, total: Number(countRows[0]?.count ?? 0) };
  }

  private orderClause(sort: SortOption, input: SearchInput): Prisma.Sql {
    switch (sort) {
      case 'relevance':
        if (input.q) {
          return Prisma.sql`ORDER BY ts_rank_cd(l."searchVector", websearch_to_tsquery('french', ${input.q})) DESC, l."publishedAt" DESC`;
        }
        return Prisma.sql`ORDER BY l."publishedAt" DESC NULLS LAST`;
      case 'newest':
        return Prisma.sql`ORDER BY l."publishedAt" DESC NULLS LAST`;
      case 'priceAsc':
        return Prisma.sql`ORDER BY l."priceCents" ASC, l."publishedAt" DESC`;
      case 'priceDesc':
        return Prisma.sql`ORDER BY l."priceCents" DESC, l."publishedAt" DESC`;
      case 'distance': {
        const point = Prisma.sql`ST_SetSRID(ST_MakePoint(${input.lng!}, ${input.lat!}), 4326)::geography`;
        return Prisma.sql`ORDER BY ST_Distance(l.location, ${point}) ASC`;
      }
    }
  }

  // ------------------- Feed rails -------------------

  /**
   * Recent listings within the per-category cap. Used by the "À découvrir"
   * rail. Sorted by publishedAt; popularity weighting comes in M8 with reviews.
   */
  async aDecouvrir(point: { lat: number; lng: number }, limit: number): Promise<ListingRow[]> {
    const p = Prisma.sql`ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)::geography`;
    return this.prisma.$queryRaw<ListingRow[]>(Prisma.sql`
      SELECT ${LISTING_COLUMNS}
      FROM listings l
      WHERE ${PUBLIC_FILTER}
        AND ST_DWithin(l.location, ${p}, ${Prisma.raw(categoryRadiusMetersSql('l'))})
      ORDER BY l."publishedAt" DESC NULLS LAST
      LIMIT ${limit}
    `);
  }

  /**
   * Listings priced in the bottom quartile of their category. Cheap "Bons
   * plans" rail. Restricted to recent (last 30 days) so old fire-sale items
   * don't dominate forever.
   */
  async bonsPlans(point: { lat: number; lng: number }, limit: number): Promise<ListingRow[]> {
    const p = Prisma.sql`ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)::geography`;
    return this.prisma.$queryRaw<ListingRow[]>(Prisma.sql`
      WITH category_quartiles AS (
        SELECT category,
          percentile_cont(0.25) WITHIN GROUP (ORDER BY "priceCents") AS p25
        FROM listings
        WHERE status = 'PUBLISHED'::"ListingStatus" AND "deletedAt" IS NULL
        GROUP BY category
      )
      SELECT ${LISTING_COLUMNS}
      FROM listings l
      JOIN category_quartiles q ON q.category = l.category
      WHERE ${PUBLIC_FILTER}
        AND l."priceCents" <= q.p25
        AND l."publishedAt" > NOW() - INTERVAL '30 days'
        AND ST_DWithin(l.location, ${p}, ${Prisma.raw(categoryRadiusMetersSql('l'))})
      ORDER BY l."priceCents" ASC
      LIMIT ${limit}
    `);
  }

  /**
   * Almost gone — low stock OR expiring within 48h. "Bientôt terminé" rail.
   */
  async bientotTermine(point: { lat: number; lng: number }, limit: number): Promise<ListingRow[]> {
    const p = Prisma.sql`ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)::geography`;
    return this.prisma.$queryRaw<ListingRow[]>(Prisma.sql`
      SELECT ${LISTING_COLUMNS}
      FROM listings l
      WHERE ${PUBLIC_FILTER}
        AND (
          l."quantityAvailable" <= 2
          OR (l."expiresAt" IS NOT NULL AND l."expiresAt" < NOW() + INTERVAL '48 hours')
        )
        AND ST_DWithin(l.location, ${p}, ${Prisma.raw(categoryRadiusMetersSql('l'))})
      ORDER BY COALESCE(l."expiresAt", NOW() + INTERVAL '7 days') ASC, l."quantityAvailable" ASC
      LIMIT ${limit}
    `);
  }

  /**
   * Services nearby — category=SERVICES sorted by distance. "Services près
   * de toi" rail.
   */
  async servicesPresDeToi(
    point: { lat: number; lng: number },
    limit: number,
  ): Promise<ListingRow[]> {
    const p = Prisma.sql`ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)::geography`;
    return this.prisma.$queryRaw<ListingRow[]>(Prisma.sql`
      SELECT ${LISTING_COLUMNS}
      FROM listings l
      WHERE ${PUBLIC_FILTER}
        AND l.category = 'SERVICES'::"ListingCategory"
        AND ST_DWithin(l.location, ${p}, ${Prisma.raw(categoryRadiusMetersSql('l'))})
      ORDER BY ST_Distance(l.location, ${p}) ASC
      LIMIT ${limit}
    `);
  }

  /**
   * Distinct sellers within radius, sorted by nearest listing distance.
   * Used by "Vendeurs proches".
   */
  async vendeursProches(
    point: { lat: number; lng: number },
    limit: number,
  ): Promise<SellerNearbyRow[]> {
    const p = Prisma.sql`ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)::geography`;
    return this.prisma.$queryRaw<SellerNearbyRow[]>(Prisma.sql`
      WITH per_seller AS (
        SELECT
          sp.id AS "sellerId",
          sp."bannerUrl",
          u.id AS "userId",
          u."displayName",
          u."avatarUrl",
          MIN(ST_Distance(l.location, ${p})) AS distance_m
        FROM seller_profiles sp
        JOIN users u ON u.id = sp."userId"
        JOIN listings l ON l."sellerId" = sp.id
          AND l.status = 'PUBLISHED'::"ListingStatus"
          AND l."deletedAt" IS NULL
        WHERE ST_DWithin(l.location, ${p}, 30000)
        GROUP BY sp.id, u.id
      )
      SELECT * FROM per_seller ORDER BY distance_m ASC LIMIT ${limit}
    `);
  }
}

export interface SellerNearbyRow {
  sellerId: string;
  bannerUrl: string | null;
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  distance_m: number;
}
