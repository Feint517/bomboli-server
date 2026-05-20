import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { observabilityConfig } from '@config/observability.config';

import { MetricsService } from './metrics.service';

@Global()
@Module({
  imports: [ConfigModule.forFeature(observabilityConfig)],
  providers: [MetricsService],
  exports: [MetricsService, ConfigModule],
})
export class ObservabilityModule {}
