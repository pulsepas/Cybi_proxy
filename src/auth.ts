import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Config } from './config.js';

function extractToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    return header.slice('Bearer '.length).trim();
  }
  const q = req.query as Record<string, unknown> | undefined;
  const qt = q?.token;
  if (typeof qt === 'string' && qt.length > 0) return qt;
  return null;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function registerAuth(app: FastifyInstance, cfg: Config) {
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/v1/')) return;
    const token = extractToken(req);
    if (!token || !safeEqual(token, cfg.CLIENT_TOKEN)) {
      reply.code(401).send({ error: 'unauthorized' });
    }
  });
}
