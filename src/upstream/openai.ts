const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';

export interface OpenAICallArgs {
  apiKey: string;
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: unknown }>;
  max_tokens?: number;
  stream?: boolean;
  signal?: AbortSignal;
}

export async function callOpenAI(args: OpenAICallArgs): Promise<Response> {
  const body = {
    model: args.model,
    messages: args.messages,
    ...(args.max_tokens ? { max_tokens: args.max_tokens } : {}),
    ...(args.stream ? { stream: true } : {}),
  };
  return fetch(OPENAI_CHAT_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${args.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: args.signal,
  });
}
