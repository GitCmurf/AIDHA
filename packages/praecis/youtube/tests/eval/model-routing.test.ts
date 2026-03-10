import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createProviderAwareClient } from "../../src/cli-eval";
import type { ResolvedConfig } from "@aidha/config";
import * as llmClient from "../../src/extract/llm-client";

// Mock the getModel registry
vi.mock("../../src/eval/model-registry", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../src/eval/model-registry")>();
  return {
    ...mod,
    getModel: vi.fn((id: string) => {
      if (id === "test-openai") return { id, provider: "openai" };
      if (id === "test-anthropic") return { id, provider: "anthropic" };
      if (id === "test-deepseek") return { id, provider: "deepseek", baseUrl: "https://custom.deepseek.com" };
      if (id === "test-alien") return { id, provider: "alien" };
      if (id === "test-unknown") return undefined;
      return mod.getModel(id);
    }),
  };
});

describe("Model-Aware Runtime Wiring", () => {
  let originalEnv: NodeJS.ProcessEnv;
  const mockBaseConfig: ResolvedConfig["llm"] = {
    model: "default-model",
    apiKey: "base-key", // pragma: allowlist secret
    baseUrl: "https://base.url",
    timeoutMs: 1000,
    cacheDir: "test",
  };

  beforeEach(() => {
    originalEnv = process.env;
    process.env = { ...originalEnv };
    vi.spyOn(llmClient, "createLlmClientFromConfig").mockImplementation((config) => {
      return {
        ok: true,
        value: { config } as any, // Mock client object returning its config for inspection
      };
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("should use process.env.OPENAI_API_KEY and default URL for openai models", () => {
    process.env.OPENAI_API_KEY = "mock-openai-key"; // pragma: allowlist secret
    const client = createProviderAwareClient("test-openai", mockBaseConfig) as any;

    expect(client.config.apiKey).toBe("mock-openai-key"); // pragma: allowlist secret
    // Since baseConfig.baseUrl is set, it uses baseConfig.baseUrl
    expect(client.config.baseUrl).toBe("https://base.url");
  });

  it("should override base URL for openai if base config has no URL", () => {
    process.env.OPENAI_API_KEY = "mock-openai-key"; // pragma: allowlist secret
    const emptyBase = { ...mockBaseConfig, baseUrl: "" };
    const client = createProviderAwareClient("test-openai", emptyBase) as any;

    expect(client.config.baseUrl).toBe("https://api.openai.com/v1");
  });

  it("should use OPENROUTER_API_KEY for anthropic models and ignore baseConfig URL", () => {
    process.env.OPENROUTER_API_KEY = "mock-openrouter-key"; // pragma: allowlist secret
    const client = createProviderAwareClient("test-anthropic", mockBaseConfig) as any;

    expect(client.config.apiKey).toBe("mock-openrouter-key"); // pragma: allowlist secret
    // Should NOT be "https://base.url" from mockBaseConfig, because it's an anthropic model
    expect(client.config.baseUrl).toBe("https://openrouter.ai/api/v1");
  });
it("should respect explicit model baseUrl over defaults", () => {
  process.env.DEEPSEEK_API_KEY = "mock-deepseek-key"; // pragma: allowlist secret
  const emptyBase = { ...mockBaseConfig, baseUrl: "" };
  const client = createProviderAwareClient("test-deepseek", emptyBase) as any;

  expect(client.config.apiKey).toBe("mock-deepseek-key"); // pragma: allowlist secret
  expect(client.config.baseUrl).toBe("https://custom.deepseek.com");
});

it("should fail explicitly if provider is completely unsupported", () => {
  vi.mocked(llmClient.createLlmClientFromConfig).mockRestore();

  expect(() => {
    createProviderAwareClient("test-alien", mockBaseConfig);
  }).toThrowError(/Unsupported provider 'alien'/);
});it("should fallback to base config if model is not in registry (treated as openai)", () => {
  const client = createProviderAwareClient("test-unknown", mockBaseConfig) as any;

  expect(client.config.apiKey).toBe("base-key");
  expect(client.config.baseUrl).toBe("https://base.url");
});
});
