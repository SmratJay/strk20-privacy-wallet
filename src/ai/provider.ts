/**
 * @file src/ai/provider.ts
 * @description Isolated LLM provider for Hamster AI.
 *
 * The provider is a single seam: swap the model/endpoint by changing env vars or this file
 * without touching the agent/policy/UI. Uses `fetch` against an OpenAI-compatible
 * `/chat/completions` endpoint (OpenAI, OpenRouter, Together, Groq, local llama.cpp, …) —
 * no SDK dependency. Always requests strict JSON (`response_format.json_object` where the
 * endpoint supports it) and defensively extracts the first JSON object from the reply.
 */
export interface AiProvider {
  completeJson(system: string, user: string): Promise<unknown>;
}

export interface OpenAiCompatibleConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

export const DEFAULT_AI_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_AI_MODEL = 'gpt-4o-mini';

export class OpenAiCompatibleProvider implements AiProvider {
  private readonly config: OpenAiCompatibleConfig;

  constructor(config: OpenAiCompatibleConfig) {
    if (!config.baseUrl) throw new Error('AI base URL is not configured.');
    if (!config.apiKey) throw new Error('AI API key is not configured.');
    if (!config.model) throw new Error('AI model is not configured.');
    this.config = { timeoutMs: 30_000, ...config };
  }

  async completeJson(system: string, user: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const res = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature: 0.2,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`AI provider ${res.status}: ${body.slice(0, 300)}`);
      }
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = data?.choices?.[0]?.message?.content;
      if (!content) throw new Error('AI provider returned no content.');
      const jsonText = extractJsonObject(content);
      return JSON.parse(jsonText);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Extract the first balanced JSON object from arbitrary text (handles code fences/prefix). */
export function extractJsonObject(text: string): string {
  const start = text.indexOf('{');
  if (start < 0) throw new Error('No JSON object found in AI response.');
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new Error('Unbalanced JSON object in AI response.');
}

/** Build a provider from env (AI_BASE_URL / AI_API_KEY / AI_MODEL). */
export function createDefaultProvider(): AiProvider {
  const baseUrl = process.env.AI_BASE_URL || DEFAULT_AI_BASE_URL;
  const apiKey = process.env.AI_API_KEY || '';
  const model = process.env.AI_MODEL || DEFAULT_AI_MODEL;
  return new OpenAiCompatibleProvider({ baseUrl, apiKey, model });
}