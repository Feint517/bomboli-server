import { Params } from 'nestjs-pino';

const isDev = process.env.NODE_ENV !== 'production';

export const pinoLoggerOptions: Params = {
  pinoHttp: {
    level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
    transport: isDev
      ? {
          target: 'pino-pretty',
          options: {
            singleLine: true,
            translateTime: 'HH:MM:ss.l',
            ignore: 'pid,hostname,req.headers',
          },
        }
      : undefined,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-api-key"]',
        '*.password',
        '*.token',
      ],
      censor: '[REDACTED]',
    },
    customProps: (req) => ({
      correlationId: (req as { correlationId?: string }).correlationId,
    }),
  },
};
