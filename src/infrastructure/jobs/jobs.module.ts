import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { redisConfig } from '@config/redis.config';

import { ALL_QUEUES } from './queues';

/**
 * Wires BullMQ on the shared Redis instance. Both the API process and the
 * worker process import this module so they share queue tokens — the API
 * enqueues, the worker consumes.
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule.forFeature(redisConfig)],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('redis.host', 'localhost'),
          port: config.get<number>('redis.port', 6381),
          password: config.get<string>('redis.password') || undefined,
          family: 0,
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: { age: 24 * 3600, count: 1000 },
          removeOnFail: { age: 7 * 24 * 3600 },
        },
      }),
    }),
    BullModule.registerQueue(...ALL_QUEUES.map((name) => ({ name }))),
  ],
  exports: [BullModule],
})
export class JobsModule {}
