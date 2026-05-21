import { Module } from '@nestjs/common';

import { OrdersController } from './orders.controller';
import { OrdersPaymentListener } from './orders.payment-listener';
import { OrdersService } from './orders.service';

@Module({
  controllers: [OrdersController],
  providers: [OrdersService, OrdersPaymentListener],
  exports: [OrdersService],
})
export class OrdersModule {}
