import { Module } from '@nestjs/common';

import { ListingsModule } from '@modules/listings/listings.module';

import { DiscoveryRepository } from './discovery.repository';
import { FeedController } from './feed.controller';
import { FeedService } from './feed.service';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  imports: [ListingsModule],
  controllers: [SearchController, FeedController],
  providers: [DiscoveryRepository, SearchService, FeedService],
})
export class DiscoveryModule {}
