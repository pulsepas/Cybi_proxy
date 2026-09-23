// Local smoke check for the proxy: auth, `ready`, a real transcription, token redaction in logs.
// Usage: PROXY_URL=http://127.0.0.1:8080 CLIENT_TOKEN=... WAV=speech.wav [PROXY_LOG=proxy.log] node scripts/smoke.mjs
// WAV: 16 kHz / 16 bit / mono PCM. PROXY_LOG: file the proxy's stdout goes to (step f is skipped without it).
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import WebSocket from 'ws';

const base = process.env.PROXY_URL ?? 'http://127.0.0.1:8080';
const token = process.env.CLIENT_TOKEN ?? '';
const wsBase = base.replace(/^http/, 'ws');
const dgQuery =
  'model=nova-3&language=en&encoding=linear16&sample_rate=16000&channels=1' +
  '&interim_results=true&punctuate=true&smart_format=true';
let failed = 0;

function report(name, ok, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

// a, b: plain HTTP without a token (b: percent-encoded "/v1" that the router decodes).
for (const [name, path] of [
  ['a. GET /v1/transcribe without token -> 401', '/v1/transcribe'],
  ['b. GET /%76%31/transcribe without token -> 401', '/%76%31/transcribe'],
]) {
  const res = await fetch(base + path);
  report(name, res.status === 401, `status ${res.status}`);
}

// c: WS upgrade without a token must be refused before the upgrade.
{
  const status = await new Promise((resolve) => {
    const ws = new WebSocket(`${wsBase}/v1/transcribe`);
    ws.on('unexpected-response', (_req, res) => {
      resolve(res.statusCode);
      ws.terminate();
    });
    ws.on('open', () => {
      resolve('upgraded');
      ws.close();
    });
    ws.on('error', () => resolve('error'));
  });
  report('c. WS upgrade without token -> rejected with 401', status === 401, `got ${status}`);
}

// d, e: bearer header, wait for `ready`, stream the WAV in real time, collect finals.
{
  const wav = readFileSync(process.env.WAV);
  const pcm = wav.subarray(wav.indexOf('data') + 8); // skip RIFF header (not always 44 bytes)
  const ws = new WebSocket(`${wsBase}/v1/transcribe?${dgQuery}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const finals = [];
  let first = null;
  const closed = new Promise((resolve) => ws.on('close', resolve));
  const ready = new Promise((resolve) => {
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      const msg = JSON.parse(data.toString());
      if (first === null) {
        first = msg;
        resolve();
      }
      const text = msg.channel?.alternatives?.[0]?.transcript;
      if (msg.type === 'Results' && msg.is_final && text) finals.push(text);
    });
    ws.on('error', (err) => {
      first ??= { error: err.message };
      resolve();
    });
  });
  await Promise.race([ready, sleep(5000)]);
  const gotReady = first?.type === 'ready';
  report('d. first text message is {"type":"ready"} within 5 s', gotReady, JSON.stringify(first));

  if (gotReady) {
    for (let i = 0; i < pcm.length && ws.readyState === WebSocket.OPEN; i += 3200) {
      ws.send(pcm.subarray(i, i + 3200));
      await sleep(100);
    }
    ws.send(JSON.stringify({ type: 'CloseStream' }));
    await Promise.race([closed, sleep(10_000)]);
  }
  ws.terminate();
  report('e. non-empty final transcript', finals.length > 0, `"${finals.join(' ')}"`);
}

// f: a connection with ?token= must not put the token into the proxy log.
if (process.env.PROXY_LOG) {
  await new Promise((resolve) => {
    const ws = new WebSocket(`${wsBase}/v1/transcribe?token=${token}&${dgQuery}`);
    ws.on('message', () => ws.close());
    ws.on('close', resolve);
    ws.on('error', resolve);
  });
  await sleep(1000); // let the logger flush
  const log = readFileSync(process.env.PROXY_LOG, 'utf8');
  report(
    'f. ?token= is redacted in the proxy log',
    log.includes('token=[REDACTED]') && !log.includes(token),
    `redacted url logged: ${log.includes('token=[REDACTED]')}, raw token in log: ${log.includes(token)}`,
  );
} else {
  report('f. ?token= is redacted in the proxy log', false, 'PROXY_LOG not set');
}

process.exit(failed ? 1 : 0);
