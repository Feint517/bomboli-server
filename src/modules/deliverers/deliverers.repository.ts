import { Injectable } from '@nestjs/common';
import { Prisma, VehicleType } from '@prisma/client';

import { PrismaService } from '@infrastructure/database/prisma.service';

export interface DelivererRow {
  id: string;
  userId: string;
  vehicleType: VehicleType;
  phoneMasked: string;
  available: boolean;
  lat: number | null;
  lng: number | null;
  createdAt: Date;
  updatedAt: Date;
}

const SELECT_COLUMNS = Prisma.sql`
  id, "userId", "vehicleType", "phoneMasked", available,
  ST_Y("currentLocation"::geometry) AS lat,
  ST_X("currentLocation"::geometry) AS lng,
  "createdAt", "updatedAt"
`;

@Injectable()
export class DeliverersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<DelivererRow | null> {
    const rows = await this.prisma.$queryRaw<DelivererRow[]>(Prisma.sql`
      SELECT ${SELECT_COLUMNS} FROM deliverers WHERE id = ${id} LIMIT 1
    `);
    return rows[0] ?? null;
  }

  async findByUserId(userId: string): Promise<DelivererRow | null> {
    const rows = await this.prisma.$queryRaw<DelivererRow[]>(Prisma.sql`
      SELECT ${SELECT_COLUMNS} FROM deliverers WHERE "userId" = ${userId} LIMIT 1
    `);
    return rows[0] ?? null;
  }

  async list(opts: { onlyAvailable?: boolean } = {}): Promise<DelivererRow[]> {
    const filter = opts.onlyAvailable ? Prisma.sql`WHERE available = TRUE` : Prisma.empty;
    return this.prisma.$queryRaw<DelivererRow[]>(Prisma.sql`
      SELECT ${SELECT_COLUMNS} FROM deliverers ${filter}
      ORDER BY "createdAt" DESC
    `);
  }

  async create(input: {
    userId: string;
    vehicleType: VehicleType;
    phoneMasked: string;
  }): Promise<DelivererRow> {
    const created = await this.prisma.deliverer.create({
      data: {
        userId: input.userId,
        vehicleType: input.vehicleType,
        phoneMasked: input.phoneMasked,
      },
    });
    return (await this.findById(created.id))!;
  }

  async updateLocation(id: string, lat: number, lng: number): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE deliverers
      SET "currentLocation" = ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
          "updatedAt" = NOW()
      WHERE id = ${id}
    `;
  }

  async setAvailable(id: string, available: boolean): Promise<DelivererRow | null> {
    await this.prisma.deliverer.update({ where: { id }, data: { available } });
    return this.findById(id);
  }
}
