import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ulid } from 'ulid';

import { PrismaService } from '@infrastructure/database/prisma.service';

export interface AddressRow {
  id: string;
  userId: string;
  label: string;
  formatted: string;
  lat: number;
  lng: number;
  gateCode: string | null;
  floor: string | null;
  deliveryInstructions: string | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface CreateInput {
  userId: string;
  label: string;
  formatted: string;
  lat: number;
  lng: number;
  gateCode?: string | null;
  floor?: string | null;
  deliveryInstructions?: string | null;
  isDefault: boolean;
}

interface UpdateInput {
  label?: string;
  formatted?: string;
  lat?: number;
  lng?: number;
  gateCode?: string | null;
  floor?: string | null;
  deliveryInstructions?: string | null;
}

const SELECT_COLUMNS = Prisma.sql`
  id, "userId", label, formatted,
  ST_Y(location::geometry) AS lat,
  ST_X(location::geometry) AS lng,
  "gateCode", floor, "deliveryInstructions",
  "isDefault", "createdAt", "updatedAt"
`;

/**
 * Direct PostGIS access via raw SQL. Prisma's generated `Address` type omits
 * the `location` column (Unsupported), so all reads/writes that touch it
 * route through this repository.
 */
@Injectable()
export class AddressesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listByUser(userId: string): Promise<AddressRow[]> {
    return this.prisma.$queryRaw<AddressRow[]>(Prisma.sql`
      SELECT ${SELECT_COLUMNS}
      FROM addresses
      WHERE "userId" = ${userId}
      ORDER BY "isDefault" DESC, "createdAt" ASC
    `);
  }

  async findById(id: string): Promise<AddressRow | null> {
    const rows = await this.prisma.$queryRaw<AddressRow[]>(Prisma.sql`
      SELECT ${SELECT_COLUMNS}
      FROM addresses
      WHERE id = ${id}
      LIMIT 1
    `);
    return rows[0] ?? null;
  }

  /**
   * Creates an address. If `isDefault` is true, atomically clears any
   * existing default for the user first.
   */
  async create(input: CreateInput): Promise<AddressRow> {
    const id = ulid();
    return this.prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.$executeRaw`
          UPDATE addresses SET "isDefault" = FALSE WHERE "userId" = ${input.userId}
        `;
      }
      await tx.$executeRaw`
        INSERT INTO addresses (
          id, "userId", label, formatted, location,
          "gateCode", floor, "deliveryInstructions",
          "isDefault", "createdAt", "updatedAt"
        ) VALUES (
          ${id}, ${input.userId}, ${input.label}, ${input.formatted},
          ST_SetSRID(ST_MakePoint(${input.lng}, ${input.lat}), 4326)::geography,
          ${input.gateCode ?? null}, ${input.floor ?? null}, ${input.deliveryInstructions ?? null},
          ${input.isDefault}, NOW(), NOW()
        )
      `;
      const rows = await tx.$queryRaw<AddressRow[]>(Prisma.sql`
        SELECT ${SELECT_COLUMNS} FROM addresses WHERE id = ${id}
      `);
      return rows[0]!;
    });
  }

  async update(id: string, input: UpdateInput): Promise<AddressRow | null> {
    const sets: Prisma.Sql[] = [];
    if (input.label !== undefined) sets.push(Prisma.sql`label = ${input.label}`);
    if (input.formatted !== undefined) sets.push(Prisma.sql`formatted = ${input.formatted}`);
    if (input.lat !== undefined && input.lng !== undefined) {
      sets.push(
        Prisma.sql`location = ST_SetSRID(ST_MakePoint(${input.lng}, ${input.lat}), 4326)::geography`,
      );
    }
    if (input.gateCode !== undefined) sets.push(Prisma.sql`"gateCode" = ${input.gateCode}`);
    if (input.floor !== undefined) sets.push(Prisma.sql`floor = ${input.floor}`);
    if (input.deliveryInstructions !== undefined) {
      sets.push(Prisma.sql`"deliveryInstructions" = ${input.deliveryInstructions}`);
    }
    if (sets.length === 0) {
      return this.findById(id);
    }
    sets.push(Prisma.sql`"updatedAt" = NOW()`);
    await this.prisma.$executeRaw(
      Prisma.sql`UPDATE addresses SET ${Prisma.join(sets, ', ')} WHERE id = ${id}`,
    );
    return this.findById(id);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.$executeRaw`DELETE FROM addresses WHERE id = ${id}`;
  }

  /**
   * Atomically flips `isDefault`: clears every other address for the user,
   * then sets this one true. Returns the updated row.
   */
  async setDefault(userId: string, id: string): Promise<AddressRow | null> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE addresses SET "isDefault" = FALSE WHERE "userId" = ${userId} AND id <> ${id}
      `;
      await tx.$executeRaw`
        UPDATE addresses SET "isDefault" = TRUE, "updatedAt" = NOW()
        WHERE id = ${id} AND "userId" = ${userId}
      `;
      const rows = await tx.$queryRaw<AddressRow[]>(Prisma.sql`
        SELECT ${SELECT_COLUMNS} FROM addresses WHERE id = ${id}
      `);
      return rows[0] ?? null;
    });
  }
}
