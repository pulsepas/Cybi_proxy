import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import type { Config } from '../config.js';
import type { Budget } from '../budget.js';
import { buildDeepgramUrl, openDeepgramSocket } from '../upstream/deepgram.js';

const KEEPALIVE_INTERVAL_MS = 8_000;
const KEEPALIVE_MESSAGE = JSON.stringify({ type: 'KeepAlive' });

function clampCloseCode(code: number | undefined): number {
  if (typeof code !== 'number' || !Number.isFinite(code)) return 1000;
  if (code < 1000 || code > 4999) return 1000;
  if (code === 1005 || code === 1006 || code === 1015) return 1000;
  return code;
}

export async function transcribeRoutes(
  app: FastifyInstance,
  opts: { cfg: Config; budget: Budget },
) {
  const { cfg, budget } = opts;

  app.get('/v1/transcribe', { websocket: true }, (clientSocket, req) => {
    const sessionQuery = (req.query as Record<string, unknown> | undefined)?.session_id;
    const sessionId =
      typeof sessionQuery === 'string' && sessionQuery.length > 0 ? sessionQuery : randomUUID();
    const log = req.log.child({ sessionId, route: 'transcribe' });

    const sttCheck = budget.checkStt();
    if (!sttCheck.ok) {
      log.warn('daily_stt_cap_reached; refusing connection');
      clientSocket.close(1008, 'daily_stt_cap_reached');
      return;
    }

    const url = buildDeepgramUrl((req.query as Record<string, unknown>) ?? {});
    log.info({ url }, 'opening deepgram upstream');

    const upstream = openDeepgramSocket(url, cfg.DEEPGRAM_API_KEY);
    const openedAt = Date.now();
    let keepAliveTimer: NodeJS.Timeout | null = null;
    let closed = false;

    const accrueMinutes = () => {
      const minutes = (Date.now() - openedAt) / 60_000;
      budget.addMinutes(minutes);
      log.info({ minutes: Number(minutes.toFixed(4)) }, 'session ended');
    };

    const closeBoth = (code: number | undefined, reason: string | Buffer) => {
      if (closed) return;
      closed = true;
      if (keepAliveTimer) {
        clearInterval(keepAliveTimer);
        keepAliveTimer = null;
      }
      const safeCode = clampCloseCode(code);
      const reasonStr = typeof reason === 'string' ? reason : reason.toString('utf8');
      try {
        if (
          upstream.readyState === WebSocket.OPEN ||
          upstream.readyState === WebSocket.CONNECTING
        ) {
          upstream.close(safeCode, reasonStr);
        }
      } catch (err) {
        log.warn({ err }, 'error closing upstream');
      }
      try {
        if (
          clientSocket.readyState === WebSocket.OPEN ||
          clientSocket.readyState === WebSocket.CONNECTING
        ) {
          clientSocket.close(safeCode, reasonStr);
        }
      } catch (err) {
        log.warn({ err }, 'error closing client');
      }
      accrueMinutes();
    };

    upstream.on('open', () => {
      log.info('deepgram upstream open');
      keepAliveTimer = setInterval(() => {
        if (upstream.readyState === WebSocket.OPEN) {
          upstream.send(KEEPALIVE_MESSAGE);
        }
      }, KEEPALIVE_INTERVAL_MS);
    });

    upstream.on('message', (data, isBinary) => {
      if (clientSocket.readyState !== WebSocket.OPEN) return;
      clientSocket.send(data, { binary: isBinary });
    });

    upstream.on('close', (code, reason) => {
      log.info({ code, reason: reason.toString('utf8') }, 'deepgram upstream closed');
      closeBoth(code, reason);
    });

    upstream.on('error', (err) => {
      log.error({ err: err.message }, 'deepgram upstream error');
      closeBoth(1011, 'upstream_error');
    });

    clientSocket.on('message', (data, isBinary) => {
      if (upstream.readyState !== WebSocket.OPEN) return;
      upstream.send(data, { binary: isBinary });
    });

    clientSocket.on('close', (code, reason) => {
      log.info({ code, reason: reason.toString('utf8') }, 'client socket closed');
      closeBoth(code, reason);
    });

    clientSocket.on('error', (err) => {
      log.warn({ err: err.message }, 'client socket error');
      closeBoth(1011, 'client_error');
    });
  });
}
