import { Injectable } from '@nestjs/common';

import { RedisService } from '@infrastructure/redis/redis.service';

const MAX_ENTRIES = 50;
const TTL_SECONDS = 30 * 24 * 3600;

function key(userId: string): string {
  return `rv:${userId}`;
}

/**
 * Redis-backed recently-viewed listings per user. Sorted set keyed by listing
 * id with the timestamp as score — most recent first. Capped at 50, TTL 30
 * days. Writes happen on listing-detail GETs (wired in M2).
 */
@Injectable()
export class RecentlyViewedService {
  constructor(private readonly redis: RedisService) {}

  async record(userId: string, listingId: string): Promise<void> {
    const k = key(userId);
    const ts = Date.now();
    const pipeline = this.redis.client.multi();
    pipeline.zadd(k, ts, listingId);
    // Trim to top MAX_ENTRIES by removing the lowest-scored entries.
    pipeline.zremrangebyrank(k, 0, -MAX_ENTRIES - 1);
    pipeline.expire(k, TTL_SECONDS);
    await pipeline.exec();
  }

  /** Returns listing IDs most-recently-viewed first. */
  async list(userId: string, limit = MAX_ENTRIES): Promise<string[]> {
    return this.redis.client.zrevrange(key(userId), 0, limit - 1);
  }

  async clear(userId: string): Promise<void> {
    await this.redis.client.del(key(userId));
  }
}
