import WebSocket from 'ws';

const DEEPGRAM_WS_BASE = 'wss://api.deepgram.com/v1/listen';

const ALLOWED_PARAMS = new Set([
  'model',
  'language',
  'tier',
  'version',
  'encoding',
  'sample_rate',
  'channels',
  'interim_results',
  'punctuate',
  'profanity_filter',
  'redact',
  'diarize',
  'smart_format',
  'filler_words',
  'numerals',
  'search',
  'replace',
  'keywords',
  'utterance_end_ms',
  'endpointing',
  'vad_events',
  'no_delay',
  'multichannel',
]);

export function buildDeepgramUrl(query: Record<string, unknown>): string {
  const url = new URL(DEEPGRAM_WS_BASE);
  for (const [key, value] of Object.entries(query)) {
    if (!ALLOWED_PARAMS.has(key)) continue;
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const v of value) url.searchParams.append(key, String(v));
    } else {
      url.searchParams.append(key, String(value));
    }
  }
  return url.toString();
}

export function openDeepgramSocket(url: string, apiKey: string): WebSocket {
  return new WebSocket(url, {
    headers: { Authorization: `Token ${apiKey}` },
    perMessageDeflate: false,
  });
}
