import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';

import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Idempotent } from '@common/decorators/idempotent.decorator';
import type { AuthenticatedUser } from '@common/types/authenticated-request.type';

import { OrderListResponseDto, OrderResponseDto } from './dto/order-response.dto';
import { CancelOrderDto, CreateOrderDto, ListOrdersDto, TransitionOrderDto } from './dto/order.dto';
import { OrdersService } from './orders.service';

@Controller({ path: 'orders', version: '1' })
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /**
   * Creates an order from the caller's current cart. Idempotent on the
   * `Idempotency-Key` header — a network retry won't double-charge inventory.
   */
  @Idempotent()
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateOrderDto,
  ): Promise<OrderResponseDto> {
    return this.orders.createFromCart(actor.id, dto);
  }

  @Get()
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() dto: ListOrdersDto,
  ): Promise<OrderListResponseDto> {
    return this.orders.list(actor.id, dto);
  }

  @Get(':id')
  get(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string): Promise<OrderResponseDto> {
    return this.orders.getById(actor.id, id);
  }

  /** Seller forward transition. */
  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  transition(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: TransitionOrderDto,
  ): Promise<OrderResponseDto> {
    return this.orders.transition(actor.id, id, dto.to, {
      etaAt: dto.etaAt ? new Date(dto.etaAt) : undefined,
    });
  }

  /** Buyer or seller cancellation (status-aware). */
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CancelOrderDto,
  ): Promise<OrderResponseDto> {
    return this.orders.cancel(actor.id, id, dto.reason);
  }
}
