import { Body, Controller, Get, Patch } from '@nestjs/common';

import { CurrentUser } from '@common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@common/types/authenticated-request.type';

import { DeliverersService } from './deliverers.service';
import { DelivererResponseDto } from './dto/deliverer-response.dto';
import { UpdateDelivererAvailableDto, UpdateDelivererLocationDto } from './dto/deliverer.dto';

/**
 * Self-service endpoints for the deliverer. Each requires the caller to
 * have a Deliverer profile (created by admin); otherwise returns 403.
 */
@Controller({ path: 'deliveries', version: '1' })
export class DeliverersController {
  constructor(private readonly deliverers: DeliverersService) {}

  @Get('me')
  getMe(@CurrentUser() actor: AuthenticatedUser): Promise<DelivererResponseDto> {
    return this.deliverers.getMyProfile(actor.id);
  }

  @Patch('me/location')
  updateLocation(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: UpdateDelivererLocationDto,
  ): Promise<DelivererResponseDto> {
    return this.deliverers.updateMyLocation(actor.id, dto.lat, dto.lng);
  }

  @Patch('me/available')
  setAvailable(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: UpdateDelivererAvailableDto,
  ): Promise<DelivererResponseDto> {
    return this.deliverers.setMyAvailable(actor.id, dto.available);
  }
}
