import { Global, Module } from '@nestjs/common';

import { DeliverersAdminController } from './admin/deliverers-admin.controller';
import { DeliverersController } from './deliverers.controller';
import { DeliverersRepository } from './deliverers.repository';
import { DeliverersService } from './deliverers.service';

/**
 * Global so OrdersService can resolve deliverer ownership for status
 * transitions and embed deliverer summaries on order responses.
 */
@Global()
@Module({
  controllers: [DeliverersController, DeliverersAdminController],
  providers: [DeliverersService, DeliverersRepository],
  exports: [DeliverersService],
})
export class DeliverersModule {}
