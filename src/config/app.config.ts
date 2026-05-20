import { registerAs } from '@nestjs/config';

export const appConfig = registerAs('app', () => ({
  env: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3002', 10),
  apiVersion: process.env.API_VERSION ?? 'v1',
  name: process.env.APP_NAME ?? 'bomboli-api',
  url: process.env.APP_URL ?? 'http://localhost:3002',
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3002')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  rateLimit: {
    ttl: parseInt(process.env.RATE_LIMIT_TTL ?? '60', 10),
    max: parseInt(process.env.RATE_LIMIT_MAX ?? '100', 10),
  },
  jwt: {
    secret: process.env.JWT_SECRET ?? '',
    expiration: process.env.JWT_EXPIRATION ?? '7d',
  },
}));

export type AppConfig = ReturnType<typeof appConfig>;
