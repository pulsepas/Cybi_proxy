import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';

import { loadConfig } from './config.js';
import { buildLoggerOptions } from './logger.js';
import { registerAuth } from './auth.js';
import { createBudget } from './budget.js';
import { healthRoutes } from './routes/health.js';
import { transcribeRoutes } from './routes/transcribe.js';
import { llmRoutes } from './routes/llm.js';

async function main() {
  const cfg = loadConfig();
  const budget = createBudget(cfg);

  const app = Fastify({ logger: buildLoggerOptions(cfg) });
  const logger = app.log;

  await app.register(cors, {
    origin: cfg.ALLOWED_ORIGINS.length > 0 ? cfg.ALLOWED_ORIGINS : false,
    credentials: false,
  });

  await app.register(rateLimit, {
    global: false,
    max: 60,
    timeWindow: '1 minute',
    keyGenerator: (req) => {
      const h = req.headers.authorization;
      if (h && h.startsWith('Bearer ')) return h.slice(7);
      const q = req.query as Record<string, unknown> | undefined;
      const qt = q?.token;
      if (typeof qt === 'string') return qt;
      return req.ip;
    },
  });

  await app.register(websocket, {
    options: { maxPayload: 1 << 20 },
  });

  registerAuth(app, cfg);

  await app.register(async (scope) => {
    await healthRoutes(scope, { cfg, budget });
  });

  await app.register(async (scope) => {
    await transcribeRoutes(scope, { cfg, budget });
  });

  const llmEnabled = Boolean(cfg.ANTHROPIC_API_KEY || cfg.OPENAI_API_KEY);
  if (llmEnabled) {
    await app.register(
      async (scope) => {
        const rateLimitFactory = (scope as unknown as {
          rateLimit: (opts?: unknown) => (req: unknown, reply: unknown) => Promise<void>;
        }).rateLimit;
        scope.addHook('onRequest', rateLimitFactory());
        await llmRoutes(scope, { cfg, budget });
      },
      { prefix: '/v1/llm' },
    );
    logger.info('LLM routes enabled');
  } else {
    logger.info('LLM routes disabled (no API keys configured)');
  }

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: '0.0.0.0', port: cfg.PORT });
  logger.info({ port: cfg.PORT, env: cfg.NODE_ENV }, 'cybi-proxy listening');
}

main().catch((err) => {
  console.error('fatal startup error:', err);
  process.exit(1);
});
