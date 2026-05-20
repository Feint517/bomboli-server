import { Global, Module } from '@nestjs/common';

import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * Global so AuthModule's JwtStrategy can inject UsersService for JIT
 * provisioning without circular imports.
 */
@Global()
@Module({
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
