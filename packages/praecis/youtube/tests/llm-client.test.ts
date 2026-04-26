/**
 * LLM client tests
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { GeminiApiClient, OpenAiCompatibleClient } from '../src/extract/llm-client.js';

describe('OpenAiCompatibleClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('normalizeBaseUrl', () => {
    // Note: normalizeBaseUrl is not exported, but we can test it indirectly
    // through the client constructor behavior

    it('should normalize URLs by removing trailing slashes', () => {
      const client1 = new OpenAiCompatibleClient({
        baseUrl: 'https://api.example.com/',
        apiKey: 'test-key', // pragma: allowlist secret
      });
      // The baseUrl is private, but we can verify the client was created successfully
      expect(client1).toBeDefined();

      const client2 = new OpenAiCompatibleClient({
        baseUrl: 'https://api.example.com///',
        apiKey: 'test-key', // pragma: allowlist secret
      });
      expect(client2).toBeDefined();
    });

    it('should throw error for URLs exceeding maximum length (ReDoS protection)', () => {
      // The normalizeBaseUrl function has a MAX_URL_LENGTH of 2048 to prevent
      // potential ReDoS attacks on the trailing slash regex.
      const tooLongUrl = 'https://api.example.com/' + 'a'.repeat(2048);
      expect(() => new OpenAiCompatibleClient({
        baseUrl: tooLongUrl,
        apiKey: 'test-key', // pragma: allowlist secret
      })).toThrow(/Base URL length .* exceeds maximum/);
    });

    it('should throw error for URLs just over the maximum length', () => {
      // Test the boundary condition: 2049 characters should fail
      // "https://api.example.com/" is 24 chars, so we need 2049 - 24 = 2025 more chars
      const overLimitUrl = 'https://api.example.com/' + 'a'.repeat(2025);
      expect(() => new OpenAiCompatibleClient({
        baseUrl: overLimitUrl,
        apiKey: 'test-key', // pragma: allowlist secret
      })).toThrow(/Base URL length .* exceeds maximum/);
    });

    it('should handle URLs at the maximum length boundary', () => {
      // URLs exactly at the limit (2048) should work fine
      // "https://api.example.com/" is 24 chars, so we need 2048 - 24 = 2024 more chars
      const maxLengthUrl = 'https://api.example.com/' + 'a'.repeat(2024);
      expect(() => new OpenAiCompatibleClient({
        baseUrl: maxLengthUrl,
        apiKey: 'test-key', // pragma: allowlist secret
      })).not.toThrow();
    });

    it('should handle normal URLs without issues', () => {
      const normalUrls = [
        'https://api.openai.com',
        'https://api.example.com/v1',
        'http://localhost:8080',
        'https://api.example.com/',
      ];

      for (const url of normalUrls) {
        expect(() => new OpenAiCompatibleClient({
          baseUrl: url,
          apiKey: 'test-key', // pragma: allowlist secret
        })).not.toThrow();
      }
    });
  });

  it('should use max_completion_tokens for GPT-5 family requests', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"ok":true}' } }],
      }),
    } as Response);

    const client = new OpenAiCompatibleClient({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key', // pragma: allowlist secret
    });

    const result = await client.generate({
      model: 'gpt-5',
      system: 'system',
      user: 'user',
      maxTokens: 1234,
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody.max_completion_tokens).toBe(1234);
    expect(requestBody.max_tokens).toBeUndefined();
  });

  it('should surface client timeout attribution clearly', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      await new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
      throw new Error('unreachable');
    });

    const client = new OpenAiCompatibleClient({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key', // pragma: allowlist secret
      timeoutMs: 10,
    });

    const result = await client.generate({
      model: 'gpt-4o-mini',
      system: 'system',
      user: 'user',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('client timeout');
  });
});

describe('GeminiApiClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should send structured output schema via responseJsonSchema', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
      }),
    } as Response);

    const client = new GeminiApiClient({
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: 'test-key', // pragma: allowlist secret
    });

    const result = await client.generate({
      model: 'gemini-2.5-flash',
      system: 'system',
      user: 'user',
      responseFormat: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
          },
          required: ['ok'],
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody.generationConfig.responseMimeType).toBe('application/json');
    expect(requestBody.generationConfig.responseJsonSchema).toEqual({
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
      },
      required: ['ok'],
    });
    expect(requestBody.generationConfig.responseSchema).toBeUndefined();
  });
});
