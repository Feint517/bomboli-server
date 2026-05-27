import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import Redis, { RedisOptions } from 'ioredis';

import { redisConfig } from '@config/redis.config';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  public readonly client: Redis;

  constructor(@Inject(redisConfig.KEY) private readonly cfg: ConfigType<typeof redisConfig>) {
    // family: 0 enables dual-stack DNS so we can resolve IPv6-only hosts
    // (e.g. Railway's redis.railway.internal) without breaking IPv4 setups.
    const opts: RedisOptions = {
      host: this.cfg.host,
      port: this.cfg.port,
      family: 0,
      maxRetriesPerRequest: null,
      lazyConnect: true,
    };
    if (this.cfg.password) {
      opts.password = this.cfg.password;
    }
    this.client = this.cfg.url
      ? new Redis(this.cfg.url, { family: 0, maxRetriesPerRequest: null, lazyConnect: true })
      : new Redis(opts);
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect();
    this.logger.log('Redis connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
    this.logger.log('Redis disconnected');
  }

  async ping(): Promise<boolean> {
    try {
      const res = await this.client.ping();
      return res === 'PONG';
    } catch {
      return false;
    }
  }

  async setWithTtl(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.client.set(key, value, 'EX', ttlSeconds);
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async del(key: string): Promise<number> {
    return this.client.del(key);
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }
}
