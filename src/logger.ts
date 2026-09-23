import type { FastifyRequest, FastifyServerOptions } from 'fastify';
import type { Config } from './config.js';

export function buildLoggerOptions(cfg: Config): FastifyServerOptions['logger'] {
  const base = {
    level: cfg.LOG_LEVEL,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.query.token',
        'body.messages',
        'body.system',
        'body.prompt',
        'body.input',
      ],
      censor: '[REDACTED]',
    },
    serializers: {
      // Same fields as Fastify's default req serializer, but ?token= is masked in the URL.
      req: (req: FastifyRequest) => ({
        method: req.method,
        url: req.url.replace(/([?&]token=)[^&#]*/gi, '$1[REDACTED]'),
        host: req.host,
        remoteAddress: req.ip,
        remotePort: req.socket?.remotePort,
      }),
    },
  };

  if (cfg.NODE_ENV !== 'production') {
    return {
      ...base,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
      },
    };
  }
  return base;
}
