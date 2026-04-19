# Cybi Proxy

Thin Node.js proxy that hides Deepgram (and optionally Anthropic/OpenAI) API keys from Flutter clients, enforces bearer-token auth, and caps daily usage.

- `WS  /v1/transcribe` — bidirectional WebSocket proxy to Deepgram Live STT.
- `GET /health` — liveness + which upstreams are configured.
- `POST /v1/llm/messages` — optional; auto-enabled when `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` is set.

## Requirements

- Node.js 22+
- A Deepgram API key

## Local development

```bash
cp .env.example .env
# Set CLIENT_TOKEN (32+ chars), DEEPGRAM_API_KEY
# Optional: ANTHROPIC_API_KEY to enable LLM proxy

npm install
npm run dev
```

Health:

```bash
curl http://localhost:8080/health
```

Auth (should 401 without bearer):

```bash
curl -i "http://localhost:8080/v1/transcribe"
```

## Docker

```bash
docker compose up --build
```

Image is multi-stage (`node:22-alpine`), runs as non-root `app` user, exposes 8080, and includes a built-in HEALTHCHECK.

## Configuration

All values come from environment variables (validated with zod at boot; invalid config → process exits).

| Var | Required | Default | Notes |
|---|---|---|---|
| `PORT` | no | `8080` | |
| `NODE_ENV` | no | `development` | `production` switches to JSON logs |
| `LOG_LEVEL` | no | `info` | `fatal` / `error` / `warn` / `info` / `debug` / `trace` |
| `CLIENT_TOKEN` | **yes** | — | 32+ chars. Bearer token clients send. |
| `DEEPGRAM_API_KEY` | **yes** | — | Used server-side only. |
| `ANTHROPIC_API_KEY` | no | — | Setting enables `/v1/llm/messages`. |
| `OPENAI_API_KEY` | no | — | Setting enables `/v1/llm/messages` for OpenAI. |
| `ALLOWED_ORIGINS` | no | empty | CSV of origins. Empty → CORS denies cross-origin. |
| `STT_DAILY_MINUTES_CAP` | no | `600` | In-memory, resets at UTC midnight. |
| `LLM_DAILY_TOKENS_CAP` | no | `2000000` | In-memory, resets at UTC midnight. |

## Security model

- Every `/v1/*` request (HTTP or WS) must present `Authorization: Bearer <CLIENT_TOKEN>` or `?token=<CLIENT_TOKEN>` in the query (WS-friendly).
- Constant-time comparison against `CLIENT_TOKEN`. Missing/invalid → 401.
- LLM endpoints additionally rate-limited to 60 req/min per token.
- Daily budget caps (minutes of STT, tokens of LLM) tracked in memory.
- Logs redact `authorization`, `?token`, and LLM prompt/message bodies.

## Client usage

### Flutter — WebSocket to `/v1/transcribe`

```dart
final uri = Uri.parse(
  'wss://proxy.example.com/v1/transcribe'
  '?token=$clientToken'
  '&model=nova-3'
  '&encoding=linear16'
  '&sample_rate=16000'
  '&interim_results=true'
  '&punctuate=true'
  '&smart_format=true',
);
final channel = IOWebSocketChannel.connect(uri);

// Send PCM16 frames as binary:
channel.sink.add(audioChunk); // Uint8List

// Receive Deepgram JSON 1:1:
channel.stream.listen((msg) {
  final event = jsonDecode(msg as String);
  // event.channel.alternatives[0].transcript, event.is_final, etc.
});
```

Whitelisted upstream query params forwarded to Deepgram: `model`, `language`, `tier`, `version`, `encoding`, `sample_rate`, `channels`, `interim_results`, `punctuate`, `profanity_filter`, `redact`, `diarize`, `smart_format`, `filler_words`, `numerals`, `search`, `replace`, `keywords`, `utterance_end_ms`, `endpointing`, `vad_events`, `no_delay`, `multichannel`.

Anything else is ignored.

### Flutter — POST `/v1/llm/messages` (when enabled)

```dart
final res = await http.post(
  Uri.parse('https://proxy.example.com/v1/llm/messages'),
  headers: {
    'authorization': 'Bearer $clientToken',
    'content-type': 'application/json',
  },
  body: jsonEncode({
    'provider': 'anthropic',
    'model': 'claude-sonnet-4-6',
    'system': 'You summarize meeting transcripts.',
    'messages': [
      {'role': 'user', 'content': transcriptBuffer},
    ],
    'max_tokens': 2048,
    'stream': false,
  }),
);
```

With `stream: true` the response is SSE — consume `res.body` as a byte stream.

## Deploy to Coolify

1. Push the branch to GitHub.
2. In Coolify: **New Application → Dockerfile**, point at this repo/branch.
3. Set env vars in Coolify's environment editor (`CLIENT_TOKEN`, `DEEPGRAM_API_KEY`, optional LLM keys, `ALLOWED_ORIGINS`).
4. Bind a domain (e.g. `proxy.i2life.dev`). Traefik terminates TLS.
5. Healthcheck: `GET /health` (already in Dockerfile).
6. Resource limits: start with 256MB RAM / 0.5 CPU.

## Operational notes

- KeepAlive frames are sent to Deepgram every 8s while a client session is open (Deepgram closes idle sessions at 12s).
- Closing either side (client or Deepgram) propagates to the other with a sanitised WS close code.
- When the daily STT cap is reached, new WS connections are closed with code `1008` / reason `daily_stt_cap_reached`.
- In-memory counters are per-process — Redis-backed counters can drop in behind `src/budget.ts` when horizontal scaling is needed.

## Roadmap

- JWT-based auth with per-user budgets.
- Redis-backed budget store.
- `WS /v1/agent` (Deepgram Voice Agent).
- Persistent session history (Postgres).
