import { Global, Module } from '@nestjs/common';

import { AddressesController } from './addresses/addresses.controller';
import { AddressesRepository } from './addresses/addresses.repository';
import { AddressesService } from './addresses/addresses.service';
import { DevicesController } from './devices/devices.controller';
import { DevicesService } from './devices/devices.service';
import { RecentlyViewedController } from './recently-viewed/recently-viewed.controller';
import { RecentlyViewedService } from './recently-viewed/recently-viewed.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * Global so AuthModule's JwtStrategy can inject UsersService for JIT
 * provisioning without circular imports. RecentlyViewedService is exported
 * so the listings module (M2) can record views.
 */
@Global()
@Module({
  controllers: [UsersController, AddressesController, DevicesController, RecentlyViewedController],
  providers: [
    UsersService,
    AddressesService,
    AddressesRepository,
    DevicesService,
    RecentlyViewedService,
  ],
  exports: [UsersService, AddressesService, DevicesService, RecentlyViewedService],
})
export class UsersModule {}
