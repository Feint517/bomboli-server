import {
  ForbiddenException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, VehicleType } from '@prisma/client';

import { ErrorCodes } from '@common/constants/error-codes.constants';
import { DomainException } from '@common/exceptions/domain.exception';
import { etaFromDistanceKm, haversineKm } from '@common/geo/distance';

import { PrismaService } from '@infrastructure/database/prisma.service';

import { UsersService } from '@modules/users/users.service';

import { DelivererRow, DeliverersRepository } from './deliverers.repository';
import { DelivererResponseDto, DelivererSummaryDto } from './dto/deliverer-response.dto';

export interface CreateDelivererArgs {
  userId: string;
  vehicleType: VehicleType;
  phone: string;
}

@Injectable()
export class DeliverersService {
  private readonly logger = new Logger(DeliverersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly repo: DeliverersRepository,
  ) {}

  // ------------------- Admin -------------------

  async createByAdmin(args: CreateDelivererArgs): Promise<DelivererResponseDto> {
    const target = await this.prisma.user.findUnique({ where: { id: args.userId } });
    if (!target) throw new NotFoundException('User not found');
    const existing = await this.repo.findByUserId(args.userId);
    if (existing) {
      throw new DomainException(
        ErrorCodes.Conflict,
        'User already has a deliverer profile.',
        HttpStatus.CONFLICT,
      );
    }
    const phoneMasked = maskPhone(args.phone);
    const row = await this.repo.create({
      userId: args.userId,
      vehicleType: args.vehicleType,
      phoneMasked,
    });
    // Stash the full phone on the User row if it isn't already set. The
    // mere presence of the Deliverer row is what marks the user as a
    // deliverer — no separate role mutation.
    if (!target.phone) {
      await this.prisma.user.update({
        where: { id: args.userId },
        data: { phone: args.phone },
      });
    }
    return this.compose(row);
  }

  async list(opts: { onlyAvailable?: boolean } = {}): Promise<DelivererResponseDto[]> {
    const rows = await this.repo.list(opts);
    return Promise.all(rows.map((r) => this.compose(r)));
  }

  /**
   * Assigns a deliverer to an order and stamps an ETA computed from the
   * pickup → destination Haversine distance. Refuses to assign:
   *   - PICKUP-fulfillment orders (no delivery needed)
   *   - orders past PREPARING (the seller should set status separately)
   *   - unavailable deliverers (unless the admin forces it — not yet wired)
   */
  async assignToOrder(
    orderId: string,
    delivererId: string,
  ): Promise<{
    orderId: string;
    delivererId: string;
    etaAt: string;
    distanceKm: number;
  }> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { seller: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.fulfillmentType !== 'DELIVERY') {
      throw new DomainException(
        ErrorCodes.Conflict,
        'Cannot assign a deliverer to a PICKUP order.',
        HttpStatus.CONFLICT,
      );
    }
    if (order.status !== 'PREPARING') {
      throw new DomainException(
        ErrorCodes.Conflict,
        `Cannot assign a deliverer to an order in status ${order.status}.`,
        HttpStatus.CONFLICT,
      );
    }
    const deliverer = await this.repo.findById(delivererId);
    if (!deliverer) throw new NotFoundException('Deliverer not found');

    const dest = order.addressSnapshot as { lat?: number; lng?: number } | null;
    if (!dest || typeof dest.lat !== 'number' || typeof dest.lng !== 'number') {
      throw new DomainException(
        ErrorCodes.Conflict,
        'Order has no delivery address snapshot.',
        HttpStatus.CONFLICT,
      );
    }

    // Pickup point: prefer the seller's pickupPoint; fall back to the first
    // order item's listing.location.
    const pickup = await this.lookupPickupPoint(order.sellerId, order.id);
    const distanceKm = haversineKm(pickup, { lat: dest.lat, lng: dest.lng });
    const etaAt = etaFromDistanceKm(distanceKm);

    await this.prisma.order.update({
      where: { id: order.id },
      data: { delivererId: deliverer.id, etaAt },
    });

    this.logger.log(
      `Assigned deliverer ${deliverer.id} to order ${order.id} (~${distanceKm.toFixed(2)} km, ETA ${etaAt.toISOString()})`,
    );

    return {
      orderId: order.id,
      delivererId: deliverer.id,
      etaAt: etaAt.toISOString(),
      distanceKm,
    };
  }

  // ------------------- Self (deliverer) -------------------

  async getMyProfile(actorSupabaseId: string): Promise<DelivererResponseDto> {
    const user = await this.users.getBySupabaseIdOrFail(actorSupabaseId);
    const row = await this.repo.findByUserId(user.id);
    if (!row) throw new NotFoundException('You are not registered as a deliverer.');
    return this.compose(row);
  }

  async updateMyLocation(
    actorSupabaseId: string,
    lat: number,
    lng: number,
  ): Promise<DelivererResponseDto> {
    const row = await this.requireOwnRow(actorSupabaseId);
    await this.repo.updateLocation(row.id, lat, lng);
    return this.compose((await this.repo.findById(row.id))!);
  }

  async setMyAvailable(actorSupabaseId: string, available: boolean): Promise<DelivererResponseDto> {
    const row = await this.requireOwnRow(actorSupabaseId);
    const updated = await this.repo.setAvailable(row.id, available);
    return this.compose(updated!);
  }

  // ------------------- Helpers used by other modules -------------------

  /**
   * Used by OrdersService to allow a deliverer to update status on an order
   * they're assigned to.
   */
  async findDelivererIdByUserId(userId: string): Promise<string | null> {
    const row = await this.repo.findByUserId(userId);
    return row?.id ?? null;
  }

  /**
   * Public-facing summary embedded on order responses once a deliverer is
   * assigned. Only includes what the buyer needs to recognize their courier.
   */
  async summaryFor(delivererId: string): Promise<DelivererSummaryDto | null> {
    const row = await this.repo.findById(delivererId);
    if (!row) return null;
    const user = await this.prisma.user.findUnique({
      where: { id: row.userId },
      select: { displayName: true, avatarUrl: true },
    });
    return {
      id: row.id,
      displayName: user?.displayName ?? null,
      avatarUrl: user?.avatarUrl ?? null,
      vehicleType: row.vehicleType,
      phoneMasked: row.phoneMasked,
    };
  }

  // ------------------- Internals -------------------

  private async requireOwnRow(actorSupabaseId: string): Promise<DelivererRow> {
    const user = await this.users.getBySupabaseIdOrFail(actorSupabaseId);
    const row = await this.repo.findByUserId(user.id);
    if (!row) throw new ForbiddenException('You are not registered as a deliverer.');
    return row;
  }

  private async lookupPickupPoint(
    sellerId: string,
    orderId: string,
  ): Promise<{ lat: number; lng: number }> {
    // Try the seller's configured pickupPoint first.
    const sellerRow = await this.prisma.$queryRaw<{ lat: number | null; lng: number | null }[]>(
      Prisma.sql`
        SELECT
          ST_Y("pickupPoint"::geometry) AS lat,
          ST_X("pickupPoint"::geometry) AS lng
        FROM seller_profiles WHERE id = ${sellerId}
      `,
    );
    if (sellerRow[0]?.lat != null && sellerRow[0].lng != null) {
      return { lat: Number(sellerRow[0].lat), lng: Number(sellerRow[0].lng) };
    }
    // Fall back to the first order item's listing location.
    const itemRow = await this.prisma.$queryRaw<{ lat: number; lng: number }[]>(Prisma.sql`
      SELECT
        ST_Y(l.location::geometry) AS lat,
        ST_X(l.location::geometry) AS lng
      FROM order_items oi
      JOIN listings l ON l.id = oi."listingId"
      WHERE oi."orderId" = ${orderId}
      LIMIT 1
    `);
    if (itemRow[0]) {
      return { lat: Number(itemRow[0].lat), lng: Number(itemRow[0].lng) };
    }
    throw new DomainException(
      ErrorCodes.Conflict,
      'Cannot determine pickup point — seller has no pickupPoint and order items have no location.',
      HttpStatus.CONFLICT,
    );
  }

  private async compose(row: DelivererRow): Promise<DelivererResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: row.userId },
      select: { displayName: true, avatarUrl: true },
    });
    return {
      id: row.id,
      userId: row.userId,
      displayName: user?.displayName ?? null,
      avatarUrl: user?.avatarUrl ?? null,
      vehicleType: row.vehicleType,
      phoneMasked: row.phoneMasked,
      available: row.available,
      currentLocation:
        row.lat != null && row.lng != null ? { lat: Number(row.lat), lng: Number(row.lng) } : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

/** Masks the phone to "+243•••5678" style — last 4 digits visible. */
function maskPhone(phone: string): string {
  if (phone.length <= 4) return phone;
  const tail = phone.slice(-4);
  const head = phone.slice(0, Math.min(4, phone.length - 4));
  const middleDots = '•'.repeat(Math.max(0, phone.length - head.length - tail.length));
  return `${head}${middleDots}${tail}`;
}
