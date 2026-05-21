import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';

import { CurrentUser } from '@common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@common/types/authenticated-request.type';

import { CartService } from './cart.service';
import { CartResponseDto } from './dto/cart-response.dto';
import { AddCartItemDto, ReplaceCartDto, UpdateCartItemDto } from './dto/cart.dto';

@Controller({ path: 'cart', version: '1' })
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  get(@CurrentUser() actor: AuthenticatedUser): Promise<CartResponseDto> {
    return this.cart.getMine(actor.id);
  }

  @Post('items')
  @HttpCode(HttpStatus.OK)
  addItem(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: AddCartItemDto,
  ): Promise<CartResponseDto> {
    return this.cart.addItem(actor.id, {
      listingId: dto.listingId,
      quantity: dto.quantity,
      options: dto.options,
    });
  }

  @Patch('items/:id')
  updateItem(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateCartItemDto,
  ): Promise<CartResponseDto> {
    return this.cart.updateItem(actor.id, id, dto.quantity);
  }

  @Delete('items/:id')
  @HttpCode(HttpStatus.OK)
  removeItem(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<CartResponseDto> {
    return this.cart.removeItem(actor.id, id);
  }

  /**
   * Atomically clears the cart and adds a single item from a (possibly
   * different) seller. The Flutter UI presents a confirmation dialog when a
   * user tries to add from a different seller, then calls this on confirm.
   */
  @Post('replace')
  @HttpCode(HttpStatus.OK)
  replace(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: ReplaceCartDto,
  ): Promise<CartResponseDto> {
    return this.cart.replace(actor.id, {
      listingId: dto.listingId,
      quantity: dto.quantity,
      options: dto.options,
    });
  }
}
