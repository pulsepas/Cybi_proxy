import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';
import type { Budget } from '../budget.js';

export async function healthRoutes(
  app: FastifyInstance,
  opts: { cfg: Config; budget: Budget },
) {
  const { cfg, budget } = opts;
  app.get('/health', async () => {
    return {
      status: 'ok',
      uptime: process.uptime(),
      upstream: {
        deepgram: Boolean(cfg.DEEPGRAM_API_KEY),
        anthropic: Boolean(cfg.ANTHROPIC_API_KEY),
        openai: Boolean(cfg.OPENAI_API_KEY),
      },
      budget: budget.snapshot(),
    };
  });
}
