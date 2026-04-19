const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

export interface AnthropicCallArgs {
  apiKey: string;
  model: string;
  system?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: unknown }>;
  max_tokens: number;
  stream?: boolean;
  signal?: AbortSignal;
}

export async function callAnthropic(args: AnthropicCallArgs): Promise<Response> {
  const body = {
    model: args.model,
    max_tokens: args.max_tokens,
    messages: args.messages,
    ...(args.system ? { system: args.system } : {}),
    ...(args.stream ? { stream: true } : {}),
  };
  return fetch(ANTHROPIC_MESSAGES_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': args.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
    signal: args.signal,
  });
}
