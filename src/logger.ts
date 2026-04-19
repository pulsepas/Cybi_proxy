import type { FastifyServerOptions } from 'fastify';
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
