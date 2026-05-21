import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';

import { appConfig } from './app.config';
import { databaseConfig } from './database.config';
import { validateEnv } from './env.validation';
import { observabilityConfig } from './observability.config';
import { paymentsConfig } from './payments.config';
import { redisConfig } from './redis.config';
import { supabaseConfig } from './supabase.config';

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
      load: [
        appConfig,
        databaseConfig,
        redisConfig,
        supabaseConfig,
        observabilityConfig,
        paymentsConfig,
      ],
    }),
  ],
})
export class ConfigModule {}
