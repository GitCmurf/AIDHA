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
 * Default max tokens for unknown models.
 * Calculated as: ~12 claims × ~100 chars/claim × ~2 tokens/char ÷ 1.2 compression ≈ 2000.
 * Rounded to 2048 for power-of-2 alignment.
 */
const DEFAULT_MAX_TOKENS_FOR_UNKNOWN_MODELS = 2048;

/**
 * Default model capabilities for unknown models.
 * Assumes limited capabilities for safety, but provides sufficient maxTokens
 * for claim extraction responses (5-12 claims with multiple fields).
 */
export const DEFAULT_MODEL_CAPABILITIES: ModelCapabilities = {
  supportsReasoningEffort: false,
  supportsVerbosity: false,
  supportsStructuredOutput: false,
  defaultMaxTokens: DEFAULT_MAX_TOKENS_FOR_UNKNOWN_MODELS,
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
  // Note: 4096 tokens for claim extraction (5-12 richly populated claims), higher than typical default
  if (normalized.startsWith('gpt-5')) {
    return {
      supportsReasoningEffort: true,
      supportsVerbosity: true,
      supportsStructuredOutput: true,
      defaultMaxTokens: 4096,
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

/** Maximum number of model capabilities to cache (LRU eviction). */
const MAX_CAPABILITIES_CACHE_SIZE = 100;

/** Cached capabilities with timestamp for LRU eviction. */
interface CachedCapabilities {
  capabilities: ModelCapabilities;
  lastAccess: number;
}

export class OpenAiCompatibleClient implements LlmClient {
  private baseUrl: string;
  private apiKey?: string;
  private timeoutMs: number;
  private modelCapabilities: ModelCapabilities;
  private modelCapabilitiesConfigured: boolean;
  /** Instance cache for model capabilities to avoid repeated detection (LRU-bounded). */
  private capabilitiesCache = new Map<string, CachedCapabilities>();

  constructor(config: OpenAiCompatibleConfig) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl);
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs ?? 60_000;
    this.modelCapabilitiesConfigured = config.modelCapabilities !== undefined;
    this.modelCapabilities = config.modelCapabilities ?? DEFAULT_MODEL_CAPABILITIES;
  }

  /**
   * Gets cached capabilities for a model, detecting and caching if not already cached.
   * Uses LRU eviction to bound cache size.
   */
  private getCapabilitiesForModel(model: string): ModelCapabilities {
    const now = Date.now();
    const cached = this.capabilitiesCache.get(model);

    if (cached) {
      cached.lastAccess = now;
      return cached.capabilities;
    }

    const capabilities = detectModelCapabilities(model);
    this.capabilitiesCache.set(model, { capabilities, lastAccess: now });

    // Evict oldest entry if cache exceeds maximum size
    if (this.capabilitiesCache.size > MAX_CAPABILITIES_CACHE_SIZE) {
      const oldest = [...this.capabilitiesCache.entries()]
        .sort((a, b) => a[1].lastAccess - b[1].lastAccess)[0]?.[0];
      if (oldest) this.capabilitiesCache.delete(oldest);
    }

    return capabilities;
  }

  /**
   * Sets the model capabilities for feature gating.
   * Allows dynamic capability configuration after construction.
   */
  setModelCapabilities(capabilities: ModelCapabilities): void {
    this.modelCapabilitiesConfigured = true;
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

      // If capabilities are explicitly configured, they override per-request detection.
      // This enforces a single-model-per-client behavior for capability gating.
      // Otherwise, detect capabilities dynamically based on the requested model.
      const modelCapabilities = this.modelCapabilitiesConfigured
        ? this.modelCapabilities
        : this.getCapabilitiesForModel(request.model);

      if (modelCapabilities.supportsReasoningEffort && request.reasoningEffort) {
        body['reasoning_effort'] = request.reasoningEffort;
      }
      if (modelCapabilities.supportsVerbosity && request.verbosity) {
        body['verbosity'] = request.verbosity;
      }

      // Traditional parameters
      if (request.temperature !== undefined) {
        body['temperature'] = request.temperature;
      } else if (!modelCapabilities.supportsReasoningEffort) {
        // Only set default temperature for non-reasoning models
        body['temperature'] = 0.2;
      }

      if (request.maxTokens !== undefined) {
        body['max_tokens'] = request.maxTokens;
      } else {
        body['max_tokens'] = modelCapabilities.defaultMaxTokens;
      }

      // OpenAI-compatible structured output
      // Only add for models that support it to avoid breaking other providers
      if (request.responseFormat && modelCapabilities.supportsStructuredOutput) {
        body['response_format'] = {
          type: 'json_schema',
          json_schema: { schema: request.responseFormat.schema },
        };
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
    // Detect model capabilities from the configured model name
    const capabilities = detectModelCapabilities(cfg.model);
    return {
      ok: true,
      value: new OpenAiCompatibleClient({
        baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey || undefined,
        timeoutMs: cfg.timeoutMs ?? 60_000,
        modelCapabilities: capabilities,
      }),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}
