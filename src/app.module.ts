import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';

import { AllExceptionsFilter } from '@common/filters/all-exceptions.filter';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { BomboliThrottleGuard } from '@common/guards/throttle.guard';
import { AuditInterceptor } from '@common/interceptors/audit.interceptor';
import { IdempotencyInterceptor } from '@common/interceptors/idempotency.interceptor';
import { LoggingInterceptor } from '@common/interceptors/logging.interceptor';
import { MetricsInterceptor } from '@common/interceptors/metrics.interceptor';
import { TimeoutInterceptor } from '@common/interceptors/timeout.interceptor';
import { TransformInterceptor } from '@common/interceptors/transform.interceptor';
import { CorrelationIdMiddleware } from '@common/middleware/correlation-id.middleware';

import { ConfigModule } from '@config/config.module';

import { AuditModule } from '@infrastructure/audit/audit.module';
import { CacheModule } from '@infrastructure/cache/cache.module';
import { DatabaseModule } from '@infrastructure/database/database.module';
import { JobsModule } from '@infrastructure/jobs/jobs.module';
import { LoggerModule } from '@infrastructure/logger/logger.module';
import { ObservabilityModule } from '@infrastructure/observability/observability.module';
import { RedisModule } from '@infrastructure/redis/redis.module';
import { StorageModule } from '@infrastructure/storage/storage.module';
import { SupabaseModule } from '@infrastructure/supabase/supabase.module';

import { AuthModule } from '@modules/auth/auth.module';
import { CartModule } from '@modules/cart/cart.module';
import { DiscoveryModule } from '@modules/discovery/discovery.module';
import { HealthModule } from '@modules/health/health.module';
import { ListingsModule } from '@modules/listings/listings.module';
import { OrdersModule } from '@modules/orders/orders.module';
import { SellersModule } from '@modules/sellers/sellers.module';
import { UsersModule } from '@modules/users/users.module';

@Module({
  imports: [
    // Core platform
    ConfigModule,
    LoggerModule,

    // Infrastructure (global)
    DatabaseModule,
    RedisModule,
    CacheModule,
    SupabaseModule,
    StorageModule,
    JobsModule,
    AuditModule,
    ObservabilityModule,

    // Cross-cutting concerns
    EventEmitterModule.forRoot({ wildcard: true }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRootAsync({
      useFactory: () => [
        {
          ttl: parseInt(process.env.RATE_LIMIT_TTL ?? '60', 10) * 1000,
          limit: parseInt(process.env.RATE_LIMIT_MAX ?? '100', 10),
        },
      ],
    }),

    // Domain modules
    UsersModule,
    AuthModule,
    SellersModule,
    ListingsModule,
    DiscoveryModule,
    CartModule,
    OrdersModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: BomboliThrottleGuard },
    // Order matters: metrics outermost (measures everything), then logging,
    // then idempotency (short-circuits replays), then audit (records the
    // successful action), then transform (envelopes the response), then
    // timeout (innermost — wraps just the handler call).
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TimeoutInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
