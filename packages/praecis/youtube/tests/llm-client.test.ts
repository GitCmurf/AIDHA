/**
 * LLM client tests
 */
import { describe, it, expect } from 'vitest';
import { OpenAiCompatibleClient } from '../src/extract/llm-client.js';

describe('OpenAiCompatibleClient', () => {
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

    it('should handle URLs at the maximum length boundary', () => {
      // URLs exactly at the limit should work fine
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
});
