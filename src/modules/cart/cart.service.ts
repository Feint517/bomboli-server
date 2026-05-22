import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { Cart, CartItem, Listing, Prisma } from '@prisma/client';

import { ErrorCodes } from '@common/constants/error-codes.constants';
import { DomainException } from '@common/exceptions/domain.exception';

import { PrismaService } from '@infrastructure/database/prisma.service';

import { UsersService } from '@modules/users/users.service';

import { CartItemListingSummaryDto, CartResponseDto } from './dto/cart-response.dto';

interface CartItemWithListing extends CartItem {
  listing: Listing;
}

interface CartWithItems extends Cart {
  items: CartItemWithListing[];
}

@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  async getMine(actorSupabaseId: string): Promise<CartResponseDto> {
    const user = await this.users.getBySupabaseIdOrFail(actorSupabaseId);
    const cart = await this.loadCartWithItems(user.id);
    return this.composeWithSeller(cart);
  }

  async addItem(
    actorSupabaseId: string,
    args: { listingId: string; quantity: number; options?: Record<string, unknown> },
  ): Promise<CartResponseDto> {
    const user = await this.users.getBySupabaseIdOrFail(actorSupabaseId);
    const listing = await this.requirePurchasableListing(args.listingId);
    await this.rejectSelfPurchase(user.id, listing.sellerId);

    const cart = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.cart.findUnique({ where: { userId: user.id } });

      // Single-seller invariant. First item locks the seller + currency.
      if (existing?.sellerId && existing.sellerId !== listing.sellerId) {
        throw this.sellerConflict(existing.sellerId, listing.sellerId);
      }
      if (existing?.currency && existing.currency !== listing.currency) {
        throw new DomainException(
          ErrorCodes.Conflict,
          'Cart already contains items in a different currency.',
          HttpStatus.CONFLICT,
        );
      }

      const cartRow = existing
        ? await tx.cart.update({
            where: { id: existing.id },
            data: { sellerId: listing.sellerId, currency: listing.currency },
          })
        : await tx.cart.create({
            data: {
              userId: user.id,
              sellerId: listing.sellerId,
              currency: listing.currency,
            },
          });

      // Upsert by (cart, listing): adding the same listing twice increments
      // quantity instead of erroring.
      await tx.cartItem.upsert({
        where: { cartId_listingId: { cartId: cartRow.id, listingId: listing.id } },
        create: {
          cartId: cartRow.id,
          listingId: listing.id,
          quantity: args.quantity,
          options: (args.options ?? null) as Prisma.InputJsonValue,
        },
        update: { quantity: { increment: args.quantity } },
      });
      return cartRow;
    });

    return this.composeWithSeller(await this.loadCartWithItems(user.id, cart.id));
  }

  async updateItem(
    actorSupabaseId: string,
    itemId: string,
    quantity: number,
  ): Promise<CartResponseDto> {
    const user = await this.users.getBySupabaseIdOrFail(actorSupabaseId);
    await this.requireOwnedItem(user.id, itemId);
    await this.prisma.cartItem.update({ where: { id: itemId }, data: { quantity } });
    return this.composeWithSeller(await this.loadCartWithItems(user.id));
  }

  async removeItem(actorSupabaseId: string, itemId: string): Promise<CartResponseDto> {
    const user = await this.users.getBySupabaseIdOrFail(actorSupabaseId);
    const item = await this.requireOwnedItem(user.id, itemId);
    await this.prisma.$transaction(async (tx) => {
      await tx.cartItem.delete({ where: { id: itemId } });
      // Clear seller/currency if cart is now empty.
      const remaining = await tx.cartItem.count({ where: { cartId: item.cartId } });
      if (remaining === 0) {
        await tx.cart.update({
          where: { id: item.cartId },
          data: { sellerId: null, currency: null },
        });
      }
    });
    return this.composeWithSeller(await this.loadCartWithItems(user.id));
  }

  /** Atomically clears the cart and adds one item — used by the "switch seller" UX. */
  async replace(
    actorSupabaseId: string,
    args: { listingId: string; quantity: number; options?: Record<string, unknown> },
  ): Promise<CartResponseDto> {
    const user = await this.users.getBySupabaseIdOrFail(actorSupabaseId);
    const listing = await this.requirePurchasableListing(args.listingId);
    await this.rejectSelfPurchase(user.id, listing.sellerId);

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.cart.findUnique({ where: { userId: user.id } });
      if (existing) {
        await tx.cartItem.deleteMany({ where: { cartId: existing.id } });
        await tx.cart.update({
          where: { id: existing.id },
          data: { sellerId: listing.sellerId, currency: listing.currency },
        });
        await tx.cartItem.create({
          data: {
            cartId: existing.id,
            listingId: listing.id,
            quantity: args.quantity,
            options: (args.options ?? null) as Prisma.InputJsonValue,
          },
        });
      } else {
        await tx.cart.create({
          data: {
            userId: user.id,
            sellerId: listing.sellerId,
            currency: listing.currency,
            items: {
              create: {
                listingId: listing.id,
                quantity: args.quantity,
                options: (args.options ?? null) as Prisma.InputJsonValue,
              },
            },
          },
        });
      }
    });
    return this.composeWithSeller(await this.loadCartWithItems(user.id));
  }

  // ----- Internals -----

  private async loadCartWithItems(userId: string, knownCartId?: string): Promise<CartWithItems> {
    if (knownCartId) {
      const cart = await this.prisma.cart.findUnique({
        where: { id: knownCartId },
        include: { items: { include: { listing: true }, orderBy: { createdAt: 'asc' } } },
      });
      if (cart) return cart;
    }
    const existing = await this.prisma.cart.findUnique({
      where: { userId },
      include: { items: { include: { listing: true }, orderBy: { createdAt: 'asc' } } },
    });
    if (existing) return existing;
    // Auto-create an empty cart for first-time readers so the client gets
    // a stable cart id from day one.
    return this.prisma.cart.create({
      data: { userId },
      include: { items: { include: { listing: true } } },
    });
  }

  /** Reject buying your own listing — a marketplace user can be both
   *  buyer and seller, but they can't transact with themselves. */
  private async rejectSelfPurchase(buyerUserId: string, sellerProfileId: string): Promise<void> {
    const seller = await this.prisma.sellerProfile.findUnique({
      where: { id: sellerProfileId },
      select: { userId: true },
    });
    if (seller?.userId === buyerUserId) {
      throw new DomainException(
        ErrorCodes.Conflict,
        'You cannot purchase your own listing.',
        HttpStatus.CONFLICT,
      );
    }
  }

  private async requirePurchasableListing(listingId: string): Promise<Listing> {
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing || listing.deletedAt) {
      throw new NotFoundException('Listing not found');
    }
    if (listing.status !== 'PUBLISHED') {
      throw new DomainException(
        ErrorCodes.Conflict,
        'This listing is not available for purchase.',
        HttpStatus.CONFLICT,
      );
    }
    return listing;
  }

  private async requireOwnedItem(userId: string, itemId: string): Promise<CartItem> {
    const item = await this.prisma.cartItem.findUnique({
      where: { id: itemId },
      include: { cart: true },
    });
    if (!item || item.cart.userId !== userId) {
      throw new NotFoundException('Cart item not found');
    }
    return item;
  }

  private sellerConflict(_existingSellerId: string, _attemptedSellerId: string): DomainException {
    return new DomainException(
      ErrorCodes.CartSellerConflict,
      'Your cart already contains items from a different seller. Use /v1/cart/replace to swap.',
      HttpStatus.CONFLICT,
    );
  }

  private async composeWithSeller(cart: CartWithItems): Promise<CartResponseDto> {
    const items = cart.items.map((item) => this.composeItem(item));
    const subtotalCents = items.reduce((sum, it) => sum + it.lineTotalCents, 0);
    const sellerSummary = cart.sellerId
      ? await this.prisma.sellerProfile.findUnique({
          where: { id: cart.sellerId },
          select: {
            id: true,
            bannerUrl: true,
            user: { select: { displayName: true, avatarUrl: true } },
          },
        })
      : null;
    return {
      id: cart.id,
      sellerId: cart.sellerId,
      currency: cart.currency,
      seller: sellerSummary
        ? {
            id: sellerSummary.id,
            displayName: sellerSummary.user?.displayName ?? null,
            avatarUrl: sellerSummary.user?.avatarUrl ?? null,
            bannerUrl: sellerSummary.bannerUrl,
          }
        : null,
      items,
      itemCount: items.reduce((sum, it) => sum + it.quantity, 0),
      subtotalCents,
    };
  }

  private composeItem(item: CartItemWithListing): {
    id: string;
    listing: CartItemListingSummaryDto;
    quantity: number;
    options: Record<string, unknown> | null;
    lineTotalCents: number;
  } {
    const photos = (item.listing.photos as { url: string }[]) ?? [];
    const primaryPhotoUrl = photos[0]?.url ?? null;
    return {
      id: item.id,
      listing: {
        id: item.listing.id,
        title: item.listing.title,
        priceCents: item.listing.priceCents,
        currency: item.listing.currency,
        primaryPhotoUrl,
        status: item.listing.status,
      },
      quantity: item.quantity,
      options: item.options as Record<string, unknown> | null,
      lineTotalCents: item.listing.priceCents * item.quantity,
    };
  }
}
