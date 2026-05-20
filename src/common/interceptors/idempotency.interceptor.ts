import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Observable, from, of, switchMap, tap } from 'rxjs';

import { ErrorCodes } from '@common/constants/error-codes.constants';
import { IDEMPOTENT_METADATA_KEY } from '@common/decorators/idempotent.decorator';
import { DomainException } from '@common/exceptions/domain.exception';

import { observabilityConfig } from '@config/observability.config';

import { RedisService } from '@infrastructure/redis/redis.service';

import type { Request } from 'express';

const IN_FLIGHT_MARKER = '__bomboli:in-flight__';

/**
 * Redis-backed idempotency for routes decorated with `@Idempotent()`.
 *
 * Protocol:
 * - Client sends `Idempotency-Key: <opaque>`.
 * - First request: lock acquired (SET NX), handler runs, response cached.
 * - Replay: cached response returned verbatim.
 * - Concurrent duplicate (lock held, no response yet): 409 Conflict.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
    @Inject(observabilityConfig.KEY)
    private readonly cfg: ConfigType<typeof observabilityConfig>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const isIdempotent = this.reflector.getAllAndOverride<boolean>(IDEMPOTENT_METADATA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!isIdempotent) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request & { user?: { id: string } }>();
    const rawKey = request.headers['idempotency-key'];
    const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    if (!key || typeof key !== 'string' || key.length === 0 || key.length > 200) {
      throw new BadRequestException({
        code: ErrorCodes.ValidationFailed,
        message: 'Idempotency-Key header is required (1–200 chars).',
      });
    }

    const cacheKey = this.buildCacheKey(request, key);
    const ttl = this.cfg.idempotency.ttlSeconds;

    return from(this.redis.client.set(cacheKey, IN_FLIGHT_MARKER, 'EX', ttl, 'NX')).pipe(
      switchMap((acquired) => {
        if (acquired === 'OK') {
          return next.handle().pipe(
            tap((response) => {
              void this.storeResponse(cacheKey, response, ttl);
            }),
          );
        }
        return from(this.redis.client.get(cacheKey)).pipe(
          switchMap((stored) => {
            if (!stored || stored === IN_FLIGHT_MARKER) {
              throw new ConflictException({
                code: ErrorCodes.Conflict,
                message:
                  'A request with this Idempotency-Key is already in flight. Retry once it completes.',
              });
            }
            try {
              return of(JSON.parse(stored));
            } catch (err) {
              this.logger.error(
                `Corrupt idempotency cache entry at ${cacheKey}: ${(err as Error).message}`,
              );
              throw new DomainException(
                ErrorCodes.Unknown,
                'Idempotency cache corrupted; please retry without the Idempotency-Key.',
              );
            }
          }),
        );
      }),
    );
  }

  private buildCacheKey(request: Request & { user?: { id: string } }, key: string): string {
    const actor = request.user?.id ?? 'anon';
    return `idem:${actor}:${request.method}:${request.path}:${key}`;
  }

  private async storeResponse(key: string, response: unknown, ttl: number): Promise<void> {
    try {
      await this.redis.client.set(key, JSON.stringify(response), 'EX', ttl);
    } catch (err) {
      this.logger.warn(`Failed to cache idempotent response for ${key}: ${(err as Error).message}`);
    }
  }
}
