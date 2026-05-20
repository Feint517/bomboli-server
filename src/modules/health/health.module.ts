import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';

import { observabilityConfig } from '@config/observability.config';

import { HealthController } from './health.controller';

@Module({
  imports: [TerminusModule, ConfigModule.forFeature(observabilityConfig)],
  controllers: [HealthController],
})
export class HealthModule {}
