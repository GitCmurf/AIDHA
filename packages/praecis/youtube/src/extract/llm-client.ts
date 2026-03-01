import type { Result } from '../pipeline/types.js';

export interface LlmCompletionRequest {
  model: string;
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LlmClient {
  generate(request: LlmCompletionRequest): Promise<Result<string>>;
}

export interface OpenAiCompatibleConfig {
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
}

/** Maximum base URL length to prevent potential ReDoS attacks. */
const MAX_URL_LENGTH = 2048;

function normalizeBaseUrl(baseUrl: string): string {
  // Limit input length to prevent potential ReDoS attacks
  // Note: Inline validation used instead of @aidha/config's validateLength
  // to avoid loading the heavy barrel import (schema, loader dependencies).
  if (baseUrl.length > MAX_URL_LENGTH) {
    throw new Error(`Base URL length (${baseUrl.length}) exceeds maximum of ${MAX_URL_LENGTH}.`);
  }
  return baseUrl.replace(/\/+$/, '');
}

export class OpenAiCompatibleClient implements LlmClient {
  private baseUrl: string;
  private apiKey?: string;
  private timeoutMs: number;

  constructor(config: OpenAiCompatibleConfig) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl);
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs ?? 60_000;
  }

  async generate(request: LlmCompletionRequest): Promise<Result<string>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: request.model,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user },
          ],
          temperature: request.temperature ?? 0.2,
          max_tokens: request.maxTokens ?? 900,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        return { ok: false, error: new Error(`LLM request failed (${response.status}): ${text.slice(0, 500)}`) };
      }

      const json = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = json.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || content.length === 0) {
        return { ok: false, error: new Error('LLM response missing message content') };
      }
      return { ok: true, value: content };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** Resolved LLM config shape (matches ResolvedConfig.llm). */
export interface LlmResolvedConfig {
  model: string;
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  cacheDir: string;
}

/**
 * Create an LLM client from resolved config values.
 */
export function createLlmClientFromConfig(cfg: LlmResolvedConfig): Result<LlmClient> {
  if (!cfg.baseUrl) {
    return { ok: false, error: new Error('llm.base_url is not configured') };
  }
  try {
    return {
      ok: true,
      value: new OpenAiCompatibleClient({
        baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey || undefined,
        timeoutMs: cfg.timeoutMs ?? 60_000,
      }),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}
