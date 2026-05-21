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

import { AddressRow } from './addresses.repository';
import { AddressesService } from './addresses.service';
import { AddressResponseDto } from './dto/address-response.dto';
import { CreateAddressDto, UpdateAddressDto } from './dto/address.dto';

@Controller({ path: 'users/me/addresses', version: '1' })
export class AddressesController {
  constructor(private readonly addresses: AddressesService) {}

  @Get()
  async list(@CurrentUser() actor: AuthenticatedUser): Promise<AddressResponseDto[]> {
    const rows = await this.addresses.list(actor.id);
    return rows.map(toResponse);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateAddressDto,
  ): Promise<AddressResponseDto> {
    const row = await this.addresses.create(actor.id, dto);
    return toResponse(row);
  }

  @Patch(':id')
  async update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateAddressDto,
  ): Promise<AddressResponseDto> {
    const row = await this.addresses.update(actor.id, id, dto);
    return toResponse(row);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.addresses.remove(actor.id, id);
  }

  @Post(':id/default')
  @HttpCode(HttpStatus.OK)
  async setDefault(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<AddressResponseDto> {
    const row = await this.addresses.setDefault(actor.id, id);
    return toResponse(row);
  }
}

function toResponse(row: AddressRow): AddressResponseDto {
  return {
    id: row.id,
    label: row.label,
    formatted: row.formatted,
    lat: Number(row.lat),
    lng: Number(row.lng),
    gateCode: row.gateCode,
    floor: row.floor,
    deliveryInstructions: row.deliveryInstructions,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
