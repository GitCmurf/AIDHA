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
      if (id === "test-google-aistudio") return { id, provider: "google-aistudio" };
      if (id === "test-zai") return { id, provider: "zai" };
      if (id === "test-xiaomi") return { id, provider: "xiaomi", baseUrl: "https://custom.xiaomi.com" };
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
    vi.spyOn(llmClient, "createGeminiClientFromConfig").mockImplementation((config) => {
      return {
        ok: true,
        value: { config } as any,
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

  it("should use Gemini API configuration for google-aistudio models", () => {
    process.env.GEMINI_API_KEY = "mock-gemini-key"; // pragma: allowlist secret
    const emptyBase = { ...mockBaseConfig, baseUrl: "" };
    const client = createProviderAwareClient("test-google-aistudio", emptyBase) as any;

    expect(client.config.apiKey).toBe("mock-gemini-key"); // pragma: allowlist secret
    expect(client.config.baseUrl).toBe("https://generativelanguage.googleapis.com/v1beta");
  });

  it("should use ZAI_API_KEY for zai models", () => {
    process.env.ZAI_API_KEY = "mock-zai-key"; // pragma: allowlist secret
    const emptyBase = { ...mockBaseConfig, baseUrl: "" };
    const client = createProviderAwareClient("test-zai", emptyBase) as any;

    expect(client.config.apiKey).toBe("mock-zai-key"); // pragma: allowlist secret
    expect(client.config.baseUrl).toBe("https://api.zai.ai/v1");
  });

  it("should use XIAOMI_API_KEY for xiaomi models and respect explicit baseUrl", () => {
    process.env.XIAOMI_API_KEY = "mock-xiaomi-key"; // pragma: allowlist secret
    const emptyBase = { ...mockBaseConfig, baseUrl: "" };
    const client = createProviderAwareClient("test-xiaomi", emptyBase) as any;

    expect(client.config.apiKey).toBe("mock-xiaomi-key"); // pragma: allowlist secret
    // Model has explicit baseUrl, should use that
    expect(client.config.baseUrl).toBe("https://custom.xiaomi.com");
  });

  it("should fail explicitly if provider is completely unsupported", () => {
    vi.mocked(llmClient.createLlmClientFromConfig).mockRestore();
    vi.mocked(llmClient.createGeminiClientFromConfig).mockRestore();

    expect(() => {
      createProviderAwareClient("test-alien", mockBaseConfig);
    }).toThrowError(/not supported by the evaluation runtime/);
  });

  it("should throw if model is not in registry", () => {
    // Strict validation: unknown models should fail fast rather than silently falling back
    // This prevents configuration errors from propagating to runtime
    expect(() => {
      createProviderAwareClient("test-unknown", mockBaseConfig);
    }).toThrowError(/Model 'test-unknown' not found in the evaluation registry/);
  });
});
