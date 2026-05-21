import {
  ForbiddenException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FulfillmentType, ListingStatus, OrderStatus, Prisma } from '@prisma/client';

import { ErrorCodes } from '@common/constants/error-codes.constants';
import { DomainException } from '@common/exceptions/domain.exception';

import { PrismaService } from '@infrastructure/database/prisma.service';

import { DeliverersService } from '@modules/deliverers/deliverers.service';
import { AddressesService } from '@modules/users/addresses/addresses.service';
import { UsersService } from '@modules/users/users.service';

import {
  OrderAddressSnapshotDto,
  OrderListResponseDto,
  OrderResponseDto,
} from './dto/order-response.dto';
import { OrderEventPayload, OrderEvents, statusToEventName } from './orders.events';

interface CreateOrderInput {
  fulfillmentType: FulfillmentType;
  addressId?: string;
  deliveryFeeCents?: number;
  note?: string;
}

interface ListOrdersInput {
  status?: OrderStatus;
  role: 'buyer' | 'seller';
  offset: number;
  limit: number;
}

/**
 * Allowed status transitions. Only the seller may move through forward
 * states; cancellation has its own path with role-specific gates (see
 * `cancel`).
 */
const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PREPARING: ['ON_THE_WAY', 'CANCELLED'],
  ON_THE_WAY: ['DELIVERED', 'CANCELLED'],
  DELIVERED: ['REFUNDED'],
  CANCELLED: [],
  REFUNDED: [],
};

interface LockedListing {
  id: string;
  sellerId: string;
  status: ListingStatus;
  priceCents: number;
  currency: string;
  title: string;
  photos: { url: string }[];
  quantityAvailable: number;
  deletedAt: Date | null;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly addresses: AddressesService,
    private readonly deliverers: DeliverersService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Create an order from the caller's current cart. Atomic: locks each
   * listing's row, validates inventory, snapshots prices, decrements stock
   * (auto-marks SOLD_OUT on zero), and clears the cart. Emits
   * `order.created` after commit.
   */
  async createFromCart(actorSupabaseId: string, dto: CreateOrderInput): Promise<OrderResponseDto> {
    const user = await this.users.getBySupabaseIdOrFail(actorSupabaseId);

    // Resolve address upfront (outside the transaction) — its own checks
    // (ownership, existence) shouldn't be entangled with inventory locks.
    let addressSnapshot: OrderAddressSnapshotDto | null = null;
    if (dto.fulfillmentType === 'DELIVERY') {
      if (!dto.addressId) {
        throw new DomainException(
          ErrorCodes.ValidationFailed,
          'addressId is required for DELIVERY orders.',
          HttpStatus.BAD_REQUEST,
        );
      }
      const addr = await this.addresses.findOwnedOrFail(actorSupabaseId, dto.addressId);
      addressSnapshot = {
        label: addr.label,
        formatted: addr.formatted,
        lat: Number(addr.lat),
        lng: Number(addr.lng),
        gateCode: addr.gateCode,
        floor: addr.floor,
        deliveryInstructions: addr.deliveryInstructions,
      };
    }

    const created = await this.prisma.$transaction(
      async (tx) => {
        const cart = await tx.cart.findUnique({
          where: { userId: user.id },
          include: { items: true },
        });
        if (!cart || cart.items.length === 0) {
          throw new DomainException(ErrorCodes.Conflict, 'Cart is empty.', HttpStatus.CONFLICT);
        }
        if (!cart.sellerId || !cart.currency) {
          // Defensive: a cart with items should always have these set.
          throw new DomainException(
            ErrorCodes.Conflict,
            'Cart is in an inconsistent state. Please refresh.',
            HttpStatus.CONFLICT,
          );
        }

        // Lock all listings for the cart's items. The row lock prevents
        // concurrent orders from over-selling.
        const listingIds = cart.items.map((i) => i.listingId);
        const lockedRows = await tx.$queryRaw<LockedListing[]>(Prisma.sql`
          SELECT id, "sellerId", status, "priceCents", currency, title,
                 photos, "quantityAvailable", "deletedAt"
          FROM listings
          WHERE id = ANY(${listingIds}::text[])
          FOR UPDATE
        `);
        const locked = new Map(lockedRows.map((r) => [r.id, r]));

        const orderItemsData: Prisma.OrderItemCreateManyOrderInput[] = [];
        let subtotalCents = 0;

        for (const cartItem of cart.items) {
          const listing = locked.get(cartItem.listingId);
          if (!listing || listing.deletedAt) {
            throw new NotFoundException(`Listing ${cartItem.listingId} not found`);
          }
          if (listing.status !== 'PUBLISHED') {
            throw new DomainException(
              ErrorCodes.Conflict,
              `Listing "${listing.title}" is no longer available.`,
              HttpStatus.CONFLICT,
            );
          }
          if (listing.sellerId !== cart.sellerId) {
            // Should never happen given the cart invariant; defensive.
            throw new DomainException(
              ErrorCodes.CartSellerConflict,
              'Cart contains items from multiple sellers.',
              HttpStatus.CONFLICT,
            );
          }
          if (listing.quantityAvailable < cartItem.quantity) {
            throw new DomainException(
              ErrorCodes.OutOfStock,
              `"${listing.title}" only has ${listing.quantityAvailable} available.`,
              HttpStatus.CONFLICT,
            );
          }
          if (listing.currency !== cart.currency) {
            throw new DomainException(
              ErrorCodes.Conflict,
              'Cart currency mismatch.',
              HttpStatus.CONFLICT,
            );
          }

          const newQty = listing.quantityAvailable - cartItem.quantity;
          // Decrement (and auto-flip to SOLD_OUT when stock hits zero).
          await tx.$executeRaw`
            UPDATE listings
            SET "quantityAvailable" = ${newQty},
                status = ${newQty === 0 ? 'SOLD_OUT' : listing.status}::"ListingStatus",
                "updatedAt" = NOW()
            WHERE id = ${listing.id}
          `;

          const photoUrl =
            Array.isArray(listing.photos) && listing.photos.length > 0
              ? (listing.photos[0]?.url ?? null)
              : null;
          orderItemsData.push({
            listingId: listing.id,
            titleSnapshot: listing.title,
            priceCentsSnapshot: listing.priceCents,
            photoUrlSnapshot: photoUrl,
            quantity: cartItem.quantity,
            options: (cartItem.options ?? null) as Prisma.InputJsonValue,
          });
          subtotalCents += listing.priceCents * cartItem.quantity;
        }

        const deliveryFeeCents =
          dto.fulfillmentType === 'DELIVERY' ? (dto.deliveryFeeCents ?? 0) : 0;
        const totalCents = subtotalCents + deliveryFeeCents;

        const order = await tx.order.create({
          data: {
            buyerId: user.id,
            sellerId: cart.sellerId,
            fulfillmentType: dto.fulfillmentType,
            addressSnapshot: addressSnapshot
              ? (addressSnapshot as unknown as Prisma.InputJsonValue)
              : Prisma.JsonNull,
            subtotalCents,
            discountCents: 0,
            deliveryFeeCents,
            totalCents,
            currency: cart.currency,
            items: { createMany: { data: orderItemsData } },
          },
          include: { items: true },
        });

        // Clear the cart so the user can start a new one.
        await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
        await tx.cart.update({
          where: { id: cart.id },
          data: { sellerId: null, currency: null },
        });

        return order;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );

    this.emit(OrderEvents.Created, {
      orderId: created.id,
      buyerId: created.buyerId,
      sellerId: created.sellerId,
      status: created.status,
      at: created.createdAt,
    });

    return this.getById(actorSupabaseId, created.id);
  }

  async getById(actorSupabaseId: string, id: string): Promise<OrderResponseDto> {
    const user = await this.users.getBySupabaseIdOrFail(actorSupabaseId);
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    const sellerSupabaseId = await this.lookupSellerSupabaseId(order.sellerId);
    if (order.buyerId !== user.id && sellerSupabaseId !== actorSupabaseId) {
      throw new ForbiddenException('Not your order');
    }
    return this.compose(order);
  }

  async list(actorSupabaseId: string, input: ListOrdersInput): Promise<OrderListResponseDto> {
    const user = await this.users.getBySupabaseIdOrFail(actorSupabaseId);
    const where: Prisma.OrderWhereInput =
      input.role === 'buyer'
        ? { buyerId: user.id, ...(input.status ? { status: input.status } : {}) }
        : {
            seller: { userId: user.id },
            ...(input.status ? { status: input.status } : {}),
          };
    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: { items: true },
        orderBy: { createdAt: 'desc' },
        skip: input.offset,
        take: input.limit,
      }),
      this.prisma.order.count({ where }),
    ]);
    const results = await Promise.all(rows.map((r) => this.compose(r)));
    return {
      results,
      total,
      offset: input.offset,
      limit: input.limit,
      hasMore: input.offset + results.length < total,
    };
  }

  /**
   * Forward transition (PREPARING → ON_THE_WAY → DELIVERED). Allowed for
   * the order's seller OR the assigned deliverer — both can move the order
   * forward as they perform their part of fulfillment.
   */
  async transition(
    actorSupabaseId: string,
    id: string,
    to: OrderStatus,
    opts: { etaAt?: Date } = {},
  ): Promise<OrderResponseDto> {
    const order = await this.requireSellerOrAssignedDelivererOf(actorSupabaseId, id);
    if (!ALLOWED_TRANSITIONS[order.status].includes(to)) {
      throw new DomainException(
        ErrorCodes.InvalidOrderTransition,
        `Cannot transition order from ${order.status} to ${to}.`,
        HttpStatus.CONFLICT,
      );
    }
    if (to === 'CANCELLED' || to === 'REFUNDED') {
      throw new DomainException(
        ErrorCodes.InvalidOrderTransition,
        `Use /cancel for cancellations.`,
        HttpStatus.BAD_REQUEST,
      );
    }
    const updated = await this.prisma.order.update({
      where: { id },
      data: {
        status: to,
        ...(opts.etaAt !== undefined ? { etaAt: opts.etaAt } : {}),
      },
      include: { items: true },
    });
    this.emit(statusToEventName(updated.status), {
      orderId: updated.id,
      buyerId: updated.buyerId,
      sellerId: updated.sellerId,
      status: updated.status,
      previousStatus: order.status,
      at: updated.updatedAt,
    });
    return this.compose(updated);
  }

  /**
   * Cancel an order. Buyer can cancel only while PREPARING; seller can
   * cancel until DELIVERED. Restocks the listings.
   */
  async cancel(actorSupabaseId: string, id: string, _reason?: string): Promise<OrderResponseDto> {
    const user = await this.users.getBySupabaseIdOrFail(actorSupabaseId);
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    const sellerSupabaseId = await this.lookupSellerSupabaseId(order.sellerId);
    const isBuyer = order.buyerId === user.id;
    const isSeller = sellerSupabaseId === actorSupabaseId;
    if (!isBuyer && !isSeller) throw new ForbiddenException('Not your order');
    if (
      order.status === 'CANCELLED' ||
      order.status === 'REFUNDED' ||
      order.status === 'DELIVERED'
    ) {
      throw new DomainException(
        ErrorCodes.InvalidOrderTransition,
        `Cannot cancel an order with status ${order.status}.`,
        HttpStatus.CONFLICT,
      );
    }
    if (isBuyer && !isSeller && order.status !== 'PREPARING') {
      throw new DomainException(
        ErrorCodes.Forbidden,
        'Only the seller can cancel an order that is already on the way.',
        HttpStatus.FORBIDDEN,
      );
    }

    return this.compose(await this.cancelInternal(order.id, order.status));
  }

  /**
   * System-triggered cancel — called from the `payment.failed` event handler.
   * Skips the role checks since there's no human actor. Idempotent on
   * already-cancelled orders.
   */
  async cancelBySystem(orderId: string, reason: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true },
    });
    if (!order) return;
    if (
      order.status === 'CANCELLED' ||
      order.status === 'REFUNDED' ||
      order.status === 'DELIVERED'
    ) {
      return;
    }
    this.logger.log(`Auto-cancelling order ${orderId}: ${reason}`);
    await this.cancelInternal(orderId, order.status);
  }

  // ----- Internals -----

  private async cancelInternal(
    orderId: string,
    previousStatus: OrderStatus,
  ): Promise<Prisma.OrderGetPayload<{ include: { items: true } }>> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const items = await tx.orderItem.findMany({ where: { orderId } });
      // Restock — but only if the listing still exists.
      for (const item of items) {
        await tx.$executeRaw`
          UPDATE listings
          SET "quantityAvailable" = "quantityAvailable" + ${item.quantity},
              status = CASE WHEN status = 'SOLD_OUT'::"ListingStatus" THEN 'PUBLISHED'::"ListingStatus" ELSE status END,
              "updatedAt" = NOW()
          WHERE id = ${item.listingId} AND "deletedAt" IS NULL
        `;
      }
      return tx.order.update({
        where: { id: orderId },
        data: { status: 'CANCELLED' },
        include: { items: true },
      });
    });

    this.emit(OrderEvents.StatusCancelled, {
      orderId: updated.id,
      buyerId: updated.buyerId,
      sellerId: updated.sellerId,
      status: updated.status,
      previousStatus,
      at: updated.updatedAt,
    });
    return updated;
  }

  /** Accepts either the seller of the order or the deliverer assigned to it. */
  private async requireSellerOrAssignedDelivererOf(
    actorSupabaseId: string,
    orderId: string,
  ): Promise<{ id: string; status: OrderStatus }> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, sellerId: true, delivererId: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    const sellerSupabaseId = await this.lookupSellerSupabaseId(order.sellerId);
    if (sellerSupabaseId === actorSupabaseId) {
      return { id: order.id, status: order.status };
    }
    if (order.delivererId) {
      const actorUser = await this.users.findBySupabaseId(actorSupabaseId);
      if (actorUser) {
        const actorDelivererId = await this.deliverers.findDelivererIdByUserId(actorUser.id);
        if (actorDelivererId === order.delivererId) {
          return { id: order.id, status: order.status };
        }
      }
    }
    throw new ForbiddenException('Only the seller or assigned deliverer can perform this action');
  }

  private async lookupSellerSupabaseId(sellerProfileId: string): Promise<string | null> {
    const profile = await this.prisma.sellerProfile.findUnique({
      where: { id: sellerProfileId },
      select: { user: { select: { supabaseId: true } } },
    });
    return profile?.user?.supabaseId ?? null;
  }

  private emit(event: string, payload: OrderEventPayload): void {
    try {
      this.events.emit(event, payload);
    } catch (err) {
      this.logger.error(`Failed to emit ${event}: ${(err as Error).message}`);
    }
  }

  private async compose(
    order: Prisma.OrderGetPayload<{ include: { items: true } }>,
  ): Promise<OrderResponseDto> {
    const [sellerSummary, delivererSummary] = await Promise.all([
      this.prisma.sellerProfile.findUnique({
        where: { id: order.sellerId },
        select: {
          id: true,
          bannerUrl: true,
          user: { select: { displayName: true, avatarUrl: true } },
        },
      }),
      order.delivererId ? this.deliverers.summaryFor(order.delivererId) : Promise.resolve(null),
    ]);
    return {
      id: order.id,
      buyerId: order.buyerId,
      sellerId: order.sellerId,
      seller: sellerSummary
        ? {
            id: sellerSummary.id,
            displayName: sellerSummary.user?.displayName ?? null,
            avatarUrl: sellerSummary.user?.avatarUrl ?? null,
            bannerUrl: sellerSummary.bannerUrl,
          }
        : null,
      status: order.status,
      fulfillmentType: order.fulfillmentType,
      addressSnapshot: order.addressSnapshot as OrderAddressSnapshotDto | null,
      subtotalCents: order.subtotalCents,
      discountCents: order.discountCents,
      deliveryFeeCents: order.deliveryFeeCents,
      totalCents: order.totalCents,
      currency: order.currency,
      etaAt: order.etaAt?.toISOString() ?? null,
      delivererId: order.delivererId,
      deliverer: delivererSummary,
      paymentId: order.paymentId,
      items: order.items.map((item) => ({
        id: item.id,
        listingId: item.listingId,
        titleSnapshot: item.titleSnapshot,
        priceCentsSnapshot: item.priceCentsSnapshot,
        photoUrlSnapshot: item.photoUrlSnapshot,
        quantity: item.quantity,
        options: item.options as Record<string, unknown> | null,
        lineTotalCents: item.priceCentsSnapshot * item.quantity,
      })),
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    };
  }
}
