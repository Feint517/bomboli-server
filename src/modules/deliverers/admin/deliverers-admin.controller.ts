import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';

import { Audited } from '@common/decorators/audited.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { UserRole } from '@common/enums/user-role.enum';

import { DeliverersService } from '../deliverers.service';
import { DelivererResponseDto } from '../dto/deliverer-response.dto';
import { AssignDelivererDto, CreateDelivererDto } from '../dto/deliverer.dto';

interface AssignResponseDto {
  orderId: string;
  delivererId: string;
  etaAt: string;
  distanceKm: number;
}

@Roles(UserRole.Admin)
@Controller({ path: 'admin', version: '1' })
export class DeliverersAdminController {
  constructor(private readonly deliverers: DeliverersService) {}

  @Audited({
    action: 'deliverer.create',
    resourceType: 'Deliverer',
    resourceIdFrom: 'response.id',
  })
  @Post('deliverers')
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateDelivererDto): Promise<DelivererResponseDto> {
    return this.deliverers.createByAdmin({
      userId: dto.userId,
      vehicleType: dto.vehicleType,
      phone: dto.phone,
    });
  }

  @Get('deliverers')
  list(@Query('onlyAvailable') onlyAvailable?: string): Promise<DelivererResponseDto[]> {
    return this.deliverers.list({ onlyAvailable: onlyAvailable === 'true' });
  }

  @Audited({
    action: 'order.assign_deliverer',
    resourceType: 'Order',
    resourceIdFrom: 'params.id',
  })
  @Post('orders/:id/assign-deliverer')
  @HttpCode(HttpStatus.OK)
  assignDeliverer(
    @Param('id') orderId: string,
    @Body() dto: AssignDelivererDto,
  ): Promise<AssignResponseDto> {
    return this.deliverers.assignToOrder(orderId, dto.delivererId);
  }
}
