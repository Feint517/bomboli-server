import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { Device } from '@prisma/client';

import { CurrentUser } from '@common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@common/types/authenticated-request.type';

import { DevicesService } from './devices.service';
import { RegisterDeviceDto } from './dto/device.dto';

interface DeviceResponseDto {
  id: string;
  platform: string;
  lastSeenAt: string;
  createdAt: string;
}

@Controller({ path: 'users/me/devices', version: '1' })
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Get()
  async list(@CurrentUser() actor: AuthenticatedUser): Promise<DeviceResponseDto[]> {
    const rows = await this.devices.list(actor.id);
    return rows.map(toResponse);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async register(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: RegisterDeviceDto,
  ): Promise<DeviceResponseDto> {
    const device = await this.devices.register(actor.id, dto);
    return toResponse(device);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unregister(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.devices.unregister(actor.id, id);
  }
}

function toResponse(device: Device): DeviceResponseDto {
  return {
    id: device.id,
    platform: device.platform,
    lastSeenAt: device.lastSeenAt.toISOString(),
    createdAt: device.createdAt.toISOString(),
  };
}
