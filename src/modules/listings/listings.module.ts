import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { Queues } from '@infrastructure/jobs/queues';

import { ListingsController } from './listings.controller';
import { ListingsMapper } from './listings.mapper';
import { ListingsRepository } from './listings.repository';
import { ListingsService } from './listings.service';
import { ImageProcessingProcessor } from './photos/image-processing.processor';
import { ListingPhotosController } from './photos/listing-photos.controller';
import { ListingPhotosService } from './photos/listing-photos.service';

@Module({
  imports: [BullModule.registerQueue({ name: Queues.ImageProcessing })],
  controllers: [ListingsController, ListingPhotosController],
  providers: [
    ListingsService,
    ListingsRepository,
    ListingsMapper,
    ListingPhotosService,
    ImageProcessingProcessor,
  ],
  exports: [ListingsService, ListingsRepository, ListingsMapper],
})
export class ListingsModule {}
