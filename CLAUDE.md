# Cybi Proxy

Тонкий прокси-сервер на Node.js 22 + TypeScript + Fastify 5. Стоит между мобильным/веб-клиентом и платными API (Deepgram STT, опционально Anthropic/OpenAI LLM): прячет ключи провайдеров, требует bearer-токен от клиента, режет дневные кэпы по минутам/токенам.

## Стек

- **Runtime:** Node.js >= 22, ESM (`"type": "module"`, импорты с `.js`-расширением даже из `.ts`).
- **HTTP/WS:** Fastify 5 + `@fastify/websocket`, `@fastify/cors`, `@fastify/rate-limit`.
- **Upstream WS:** `ws` (для исходящего соединения к Deepgram).
- **Конфиг/валидация:** `zod` поверх `process.env` ([src/config.ts](src/config.ts)).
- **Логи:** `pino` с redact для токенов и LLM-промптов ([src/logger.ts](src/logger.ts)).

## Структура

- [src/index.ts](src/index.ts) — bootstrap: загрузка конфига, регистрация плагинов, graceful shutdown по SIGTERM/SIGINT.
- [src/config.ts](src/config.ts) — Zod-схема ENV; падает с понятным выводом, если что-то невалидно.
- [src/auth.ts](src/auth.ts) — `preHandler` хук на префикс `/v1/`, bearer через `Authorization: Bearer …` или `?token=`, сверка `timingSafeEqual`.
- [src/budget.ts](src/budget.ts) — in-memory счётчики STT-минут и LLM-токенов с UTC-rollover. Без персистентности; рестарт = сброс.
- [src/routes/health.ts](src/routes/health.ts) — публичный `GET /health`, отдаёт uptime, какие upstream-ключи настроены, snapshot бюджета.
- [src/routes/transcribe.ts](src/routes/transcribe.ts) — `WS /v1/transcribe`: открывает upstream к Deepgram, проксирует фреймы в обе стороны, KeepAlive каждые 8с, начисляет минуты при close, корректная пропагация close-кода (clamp в 1000–4999, замена 1005/1006/1015 на 1000).
- [src/routes/llm.ts](src/routes/llm.ts) — `POST /v1/llm/messages`: Anthropic-совместимая форма + опциональный SSE; включается только если задан `ANTHROPIC_API_KEY` или `OPENAI_API_KEY`.
- [src/upstream/deepgram.ts](src/upstream/deepgram.ts) — построение URL Deepgram, **whitelist** допустимых query-параметров (`ALLOWED_PARAMS`); все остальное молча отбрасывается.
- [src/upstream/anthropic.ts](src/upstream/anthropic.ts), [src/upstream/openai.ts](src/upstream/openai.ts) — клиенты соответствующих LLM API.

## Команды

```sh
npm run dev         # tsx watch, hot-reload
npm run typecheck   # tsc --noEmit
npm run build       # компиляция в dist/
npm start           # node dist/index.js
```

Docker: multi-stage `node:22-alpine`, non-root, есть `HEALTHCHECK` на `/health`. `docker-compose.yml` для локального запуска.

## Конфигурация

Все переменные — в [.env.example](.env.example). Обязательные: `CLIENT_TOKEN` (≥32 символа), `DEEPGRAM_API_KEY`. LLM-ключи опциональны — без них роуты `/v1/llm/*` просто не регистрируются (см. флаг `llmEnabled` в [src/index.ts](src/index.ts#L54)). Дефолты кэпов: `STT_DAILY_MINUTES_CAP=600`, `LLM_DAILY_TOKENS_CAP=2_000_000`.

## Соглашения

- **ESM-импорты с `.js`** — обязательно (`./config.js`, не `./config`), иначе Node не разрешит модуль.
- **Логи без секретов.** При добавлении новых полей с потенциально чувствительными данными — расширять `redact` в [src/logger.ts](src/logger.ts).
- **Whitelist для апстримов.** Любой новый клиентский query-параметр для Deepgram должен явно добавляться в `ALLOWED_PARAMS` ([src/upstream/deepgram.ts](src/upstream/deepgram.ts)).
- **Bearer-сравнение** только через `timingSafeEqual` ([src/auth.ts](src/auth.ts#L16)).
- **WS close-коды** — пропускать только валидные (1000–4999, без 1005/1006/1015); см. `clampCloseCode` в [src/routes/transcribe.ts](src/routes/transcribe.ts#L11).

## Деплой

Целевая площадка — Coolify. Перед пушем: `npm run typecheck && npm run build`. Текущая ветка разработки: `claude/deepgram-llm-proxy-y3N2P`.

## Что не сделано

- Бюджет — in-memory; для нескольких реплик нужен общий стор (Redis).
- Метрики/трассировка не подключены.
- Тестов нет.
