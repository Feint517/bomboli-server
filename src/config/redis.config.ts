import { registerAs } from '@nestjs/config';

export const redisConfig = registerAs('redis', () => ({
  url: process.env.REDIS_URL ?? 'redis://localhost:6381',
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6381', 10),
  password: process.env.REDIS_PASSWORD ?? '',
}));

export type RedisConfig = ReturnType<typeof redisConfig>;
