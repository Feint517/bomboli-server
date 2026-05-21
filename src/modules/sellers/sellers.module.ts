import { Global, Module } from '@nestjs/common';

import { SellersController } from './sellers.controller';
import { SellersRepository } from './sellers.repository';
import { SellersService } from './sellers.service';

/**
 * Global so the ListingsModule (M2) and future Reviews/Stats modules (M8)
 * can resolve seller IDs without a circular import dance.
 */
@Global()
@Module({
  controllers: [SellersController],
  providers: [SellersService, SellersRepository],
  exports: [SellersService],
})
export class SellersModule {}
