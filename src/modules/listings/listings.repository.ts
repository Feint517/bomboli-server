import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ulid } from 'ulid';

import { PrismaService } from '@infrastructure/database/prisma.service';

import { ListingPhotoDto } from './dto/listing-response.dto';

export type ListingCategoryValue =
  | 'COSMETIQUE'
  | 'TEXTILE'
  | 'SECONDE_MAIN'
  | 'AGRICOLE'
  | 'SERVICES'
  | 'AUTRES';

export type ListingStatusValue = 'DRAFT' | 'PUBLISHED' | 'SOLD_OUT' | 'ARCHIVED';

export interface ListingRow {
  id: string;
  sellerId: string;
  title: string;
  description: string;
  category: ListingCategoryValue;
  priceCents: number;
  currency: string;
  lat: number;
  lng: number;
  photos: ListingPhotoDto[];
  options: Record<string, unknown> | null;
  quantityAvailable: number;
  status: ListingStatusValue;
  expiresAt: Date | null;
  publishedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateListingInput {
  sellerId: string;
  title: string;
  description: string;
  category: ListingCategoryValue;
  priceCents: number;
  currency: string;
  lat: number;
  lng: number;
  quantityAvailable: number;
  options?: Record<string, unknown> | null;
  expiresAt?: Date | null;
}

export interface UpdateListingInput {
  title?: string;
  description?: string;
  category?: ListingCategoryValue;
  priceCents?: number;
  currency?: string;
  lat?: number;
  lng?: number;
  quantityAvailable?: number;
  options?: Record<string, unknown> | null;
  expiresAt?: Date | null;
}

const SELECT_COLUMNS = Prisma.sql`
  id, "sellerId", title, description, category, "priceCents", currency,
  ST_Y(location::geometry) AS lat,
  ST_X(location::geometry) AS lng,
  photos, options, "quantityAvailable", status,
  "expiresAt", "publishedAt", "deletedAt", "createdAt", "updatedAt"
`;

@Injectable()
export class ListingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string, opts: { includeDeleted?: boolean } = {}): Promise<ListingRow | null> {
    const whereDeleted = opts.includeDeleted ? Prisma.empty : Prisma.sql`AND "deletedAt" IS NULL`;
    const rows = await this.prisma.$queryRaw<ListingRow[]>(Prisma.sql`
      SELECT ${SELECT_COLUMNS} FROM listings WHERE id = ${id} ${whereDeleted} LIMIT 1
    `);
    return rows[0] ?? null;
  }

  async listBySeller(
    sellerId: string,
    opts: { onlyPublished?: boolean } = {},
  ): Promise<ListingRow[]> {
    const filter = opts.onlyPublished
      ? Prisma.sql`AND status = 'PUBLISHED'::"ListingStatus" AND "deletedAt" IS NULL`
      : Prisma.sql`AND "deletedAt" IS NULL`;
    return this.prisma.$queryRaw<ListingRow[]>(Prisma.sql`
      SELECT ${SELECT_COLUMNS} FROM listings
      WHERE "sellerId" = ${sellerId} ${filter}
      ORDER BY COALESCE("publishedAt", "createdAt") DESC
    `);
  }

  async create(input: CreateListingInput): Promise<ListingRow> {
    const id = ulid();
    await this.prisma.$executeRaw`
      INSERT INTO listings (
        id, "sellerId", title, description, category, "priceCents", currency,
        location, photos, options, "quantityAvailable", status,
        "expiresAt", "publishedAt", "createdAt", "updatedAt"
      ) VALUES (
        ${id}, ${input.sellerId}, ${input.title}, ${input.description},
        ${input.category}::"ListingCategory",
        ${input.priceCents}, ${input.currency},
        ST_SetSRID(ST_MakePoint(${input.lng}, ${input.lat}), 4326)::geography,
        '[]'::jsonb,
        ${input.options ? JSON.stringify(input.options) : null}::jsonb,
        ${input.quantityAvailable},
        'DRAFT'::"ListingStatus",
        ${input.expiresAt ?? null}, NULL, NOW(), NOW()
      )
    `;
    return (await this.findById(id))!;
  }

  async update(id: string, input: UpdateListingInput): Promise<ListingRow | null> {
    const sets: Prisma.Sql[] = [Prisma.sql`"updatedAt" = NOW()`];
    if (input.title !== undefined) sets.push(Prisma.sql`title = ${input.title}`);
    if (input.description !== undefined) sets.push(Prisma.sql`description = ${input.description}`);
    if (input.category !== undefined) {
      sets.push(Prisma.sql`category = ${input.category}::"ListingCategory"`);
    }
    if (input.priceCents !== undefined) sets.push(Prisma.sql`"priceCents" = ${input.priceCents}`);
    if (input.currency !== undefined) sets.push(Prisma.sql`currency = ${input.currency}`);
    if (input.lat !== undefined && input.lng !== undefined) {
      sets.push(
        Prisma.sql`location = ST_SetSRID(ST_MakePoint(${input.lng}, ${input.lat}), 4326)::geography`,
      );
    }
    if (input.quantityAvailable !== undefined) {
      sets.push(Prisma.sql`"quantityAvailable" = ${input.quantityAvailable}`);
    }
    if (input.options !== undefined) {
      sets.push(
        Prisma.sql`options = ${input.options ? JSON.stringify(input.options) : null}::jsonb`,
      );
    }
    if (input.expiresAt !== undefined) sets.push(Prisma.sql`"expiresAt" = ${input.expiresAt}`);
    await this.prisma.$executeRaw(
      Prisma.sql`UPDATE listings SET ${Prisma.join(sets, ', ')} WHERE id = ${id}`,
    );
    return this.findById(id);
  }

  async setStatus(
    id: string,
    status: ListingStatusValue,
    opts: { publishedAt?: Date | null } = {},
  ): Promise<ListingRow | null> {
    const sets: Prisma.Sql[] = [
      Prisma.sql`status = ${status}::"ListingStatus"`,
      Prisma.sql`"updatedAt" = NOW()`,
    ];
    if (opts.publishedAt !== undefined) {
      sets.push(Prisma.sql`"publishedAt" = ${opts.publishedAt}`);
    }
    await this.prisma.$executeRaw(
      Prisma.sql`UPDATE listings SET ${Prisma.join(sets, ', ')} WHERE id = ${id}`,
    );
    return this.findById(id);
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE listings
      SET "deletedAt" = NOW(), status = 'ARCHIVED'::"ListingStatus", "updatedAt" = NOW()
      WHERE id = ${id}
    `;
  }

  async setPhotos(id: string, photos: ListingPhotoDto[]): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE listings SET photos = ${JSON.stringify(photos)}::jsonb, "updatedAt" = NOW()
      WHERE id = ${id}
    `;
  }

  async findPublished(): Promise<ListingRow[]> {
  return this.prisma.$queryRaw<ListingRow[]>(Prisma.sql`
    SELECT ${SELECT_COLUMNS} FROM listings
    WHERE status = 'PUBLISHED'::"ListingStatus"
      AND "deletedAt" IS NULL
    ORDER BY COALESCE("publishedAt", "createdAt") DESC
  `);
  }
}
