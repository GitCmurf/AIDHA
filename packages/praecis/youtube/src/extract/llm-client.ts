import type { Result } from '../pipeline/types.js';
import { validateLength } from '@aidha/config';

export interface LlmCompletionRequest {
  model: string;
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: string;
  verbosity?: string;
  responseFormat?: { type: 'json_schema'; schema: Record<string, unknown> };
}

export interface LlmClient {
  generate(request: LlmCompletionRequest): Promise<Result<string>>;
}

export interface OpenAiCompatibleConfig {
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
  modelCapabilities?: ModelCapabilities;
}

/**
 * Model capability flags for feature gating.
 * Prevents brittle string matching against model names.
 */
export interface ModelCapabilities {
  supportsReasoningEffort: boolean;
  supportsVerbosity: boolean;
  supportsStructuredOutput: boolean;
  defaultMaxTokens: number;
}

/**
 * Default model capabilities for unknown models.
 * Assumes limited capabilities for safety.
 */
export const DEFAULT_MODEL_CAPABILITIES: ModelCapabilities = {
  supportsReasoningEffort: false,
  supportsVerbosity: false,
  supportsStructuredOutput: false,
  defaultMaxTokens: 900,
};

/**
 * Detects model capabilities from model identifier.
 * Uses string matching as a fallback for unconfigured models.
 *
 * For production, this should be replaced with a model registry.
 */
export function detectModelCapabilities(model: string): ModelCapabilities {
  const normalized = model.toLowerCase().trim();

  // GPT-5 family - has all advanced features
  if (normalized.startsWith('gpt-5')) {
    return {
      supportsReasoningEffort: true,
      supportsVerbosity: true,
      supportsStructuredOutput: true,
      defaultMaxTokens: 900,
    };
  }

  // GPT-4o and later - support structured output
  if (normalized.startsWith('gpt-4o')) {
    return {
      supportsReasoningEffort: false,
      supportsVerbosity: false,
      supportsStructuredOutput: true,
      defaultMaxTokens: 4096,
    };
  }

  // GPT-4 family - no advanced features
  if (normalized.startsWith('gpt-4')) {
    return {
      supportsReasoningEffort: false,
      supportsVerbosity: false,
      supportsStructuredOutput: false,
      defaultMaxTokens: 4096,
    };
  }

  // Default for unknown models
  return DEFAULT_MODEL_CAPABILITIES;
}

/** Maximum base URL length to prevent potential ReDoS attacks. */
const MAX_URL_LENGTH = 2048;

function normalizeBaseUrl(baseUrl: string): string {
  // Use validateLength from @aidha/config to avoid duplication
  validateLength(baseUrl, MAX_URL_LENGTH, 'Base URL');
  return baseUrl.replace(/\/+$/, '');
}

export class OpenAiCompatibleClient implements LlmClient {
  private baseUrl: string;
  private apiKey?: string;
  private timeoutMs: number;
  private modelCapabilities: ModelCapabilities;

  constructor(config: OpenAiCompatibleConfig) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl);
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs ?? 60_000;
    this.modelCapabilities = config.modelCapabilities ?? DEFAULT_MODEL_CAPABILITIES;
  }

  /**
   * Sets the model capabilities for feature gating.
   * Allows dynamic capability configuration after construction.
   */
  setModelCapabilities(capabilities: ModelCapabilities): void {
    this.modelCapabilities = capabilities;
  }

  /**
   * Gets the current model capabilities.
   */
  getModelCapabilities(): ModelCapabilities {
    return this.modelCapabilities;
  }

  async generate(request: LlmCompletionRequest): Promise<Result<string>> {
    const controller = new AbortController();
    let timeout: NodeJS.Timeout | undefined;
    if (this.timeoutMs > 0) {
      timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    }

    try {
      const body: Record<string, unknown> = {
        model: request.model,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
      };

      // Use configured model capabilities for feature gating
      const capabilities = this.modelCapabilities;

      if (capabilities.supportsReasoningEffort && request.reasoningEffort) {
        body['reasoning_effort'] = request.reasoningEffort;
      }
      if (capabilities.supportsVerbosity && request.verbosity) {
        body['verbosity'] = request.verbosity;
      }

      // Traditional parameters
      if (request.temperature !== undefined) {
        body['temperature'] = request.temperature;
      } else if (!capabilities.supportsReasoningEffort) {
        // Only set default temperature for non-reasoning models
        body['temperature'] = 0.2;
      }

      if (request.maxTokens !== undefined) {
        body['max_tokens'] = request.maxTokens;
      } else {
        body['max_tokens'] = capabilities.defaultMaxTokens;
      }

      // OpenAI-compatible structured output
      // Only add for models that support it to avoid breaking other providers
      if (request.responseFormat && capabilities.supportsStructuredOutput) {
        body['response_format'] = request.responseFormat;
      }

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
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
