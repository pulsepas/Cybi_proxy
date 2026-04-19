import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { Budget } from '../budget.js';
import { callAnthropic } from '../upstream/anthropic.js';
import { callOpenAI } from '../upstream/openai.js';

const messagesSchema = z.object({
  provider: z.enum(['anthropic', 'openai']).default('anthropic'),
  model: z.string().min(1),
  system: z.string().optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.unknown(),
      }),
    )
    .min(1),
  max_tokens: z.number().int().positive().max(16_000).default(4_096),
  stream: z.boolean().default(false),
});

export async function llmRoutes(
  app: FastifyInstance,
  opts: { cfg: Config; budget: Budget },
) {
  const { cfg, budget } = opts;

  app.post('/messages', async (req, reply) => {
    const parsed = messagesSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
      return;
    }
    const body = parsed.data;

    const sttCheck = budget.checkLlm();
    if (!sttCheck.ok) {
      reply.code(429).send({ error: 'daily_llm_cap_reached' });
      return;
    }

    if (body.provider === 'anthropic' && !cfg.ANTHROPIC_API_KEY) {
      reply.code(400).send({ error: 'anthropic_not_configured' });
      return;
    }
    if (body.provider === 'openai' && !cfg.OPENAI_API_KEY) {
      reply.code(400).send({ error: 'openai_not_configured' });
      return;
    }

    const started = Date.now();
    const log = req.log.child({ provider: body.provider, model: body.model });

    const msgs = body.messages.map((m) => ({ role: m.role, content: m.content }));
    const upstreamRes =
      body.provider === 'anthropic'
        ? await callAnthropic({
            apiKey: cfg.ANTHROPIC_API_KEY,
            model: body.model,
            ...(body.system ? { system: body.system } : {}),
            messages: msgs.filter(
              (m): m is { role: 'user' | 'assistant'; content: unknown } =>
                m.role !== 'system',
            ),
            max_tokens: body.max_tokens,
            stream: body.stream,
          })
        : await callOpenAI({
            apiKey: cfg.OPENAI_API_KEY,
            model: body.model,
            messages: msgs,
            max_tokens: body.max_tokens,
            stream: body.stream,
          });

    if (!upstreamRes.ok && !body.stream) {
      const text = await upstreamRes.text();
      log.warn({ status: upstreamRes.status }, 'upstream error');
      reply.code(upstreamRes.status).type('application/json').send(text);
      return;
    }

    if (body.stream) {
      reply.raw.writeHead(upstreamRes.status, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      const reader = upstreamRes.body?.getReader();
      if (!reader) {
        reply.raw.end();
        return;
      }
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) reply.raw.write(value);
        }
      } catch (err) {
        log.error({ err }, 'stream error');
      } finally {
        reply.raw.end();
        log.info({ ms: Date.now() - started }, 'stream finished');
      }
      return;
    }

    const json = (await upstreamRes.json()) as Record<string, unknown>;

    const usage = json.usage as
      | { input_tokens?: number; output_tokens?: number; prompt_tokens?: number; completion_tokens?: number }
      | undefined;
    if (usage) {
      const total =
        (usage.input_tokens ?? usage.prompt_tokens ?? 0) +
        (usage.output_tokens ?? usage.completion_tokens ?? 0);
      if (total > 0) budget.addTokens(total);
    }
    log.info({ ms: Date.now() - started, usage }, 'llm ok');
    reply.send(json);
  });
}
