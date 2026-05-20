import { Controller, ForbiddenException, Get, Headers, Inject, Res } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { HealthCheck, HealthCheckService, PrismaHealthIndicator } from '@nestjs/terminus';

import { Public } from '@common/decorators/public.decorator';

import { observabilityConfig } from '@config/observability.config';

import { PrismaService } from '@infrastructure/database/prisma.service';
import { MetricsService } from '@infrastructure/observability/metrics.service';
import { RedisService } from '@infrastructure/redis/redis.service';

import type { Response } from 'express';

@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaIndicator: PrismaHealthIndicator,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly metrics: MetricsService,
    @Inject(observabilityConfig.KEY)
    private readonly observability: ConfigType<typeof observabilityConfig>,
  ) {}

  @Public()
  @Get()
  liveness() {
    return {
      status: 'ok',
      uptime: process.uptime(),
      env: process.env.NODE_ENV ?? 'development',
    };
  }

  @Public()
  @Get('ready')
  @HealthCheck()
  readiness() {
    return this.health.check([
      async () => this.prismaIndicator.pingCheck('database', this.prisma),
      async () => {
        const ok = await this.redis.ping();
        return { redis: { status: ok ? 'up' : 'down' } };
      },
    ]);
  }

  /**
   * Prometheus metrics. Gated by METRICS_TOKEN if set; otherwise open in
   * non-production and 403 in production to avoid accidental exposure.
   */
  @Public()
  @Get('metrics')
  async metricsEndpoint(
    @Headers('authorization') auth: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const token = this.observability.metrics.token;
    if (token) {
      const expected = `Bearer ${token}`;
      if (auth !== expected) {
        throw new ForbiddenException('Metrics access denied');
      }
    } else if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('Metrics endpoint requires METRICS_TOKEN in production');
    }
    const { contentType, body } = await this.metrics.expose();
    res.setHeader('Content-Type', contentType);
    res.send(body);
  }
}
