import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createProviderAwareClient, resolveProviderConnection } from "../../src/cli-eval";
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
      if (id === "test-openrouter") return { id, provider: "openrouter" };
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

    // Clean up environment variables that might leak into tests
    delete process.env.GOOGLE_AISTUDIO_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.AIDHA_GOOGLE_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.AIDHA_OPENAI_API_KEY;

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

  it("should use AIDHA_OPENAI_API_KEY when OPENAI_API_KEY is not set", () => {
    process.env.AIDHA_OPENAI_API_KEY = "mock-aidha-openai-key"; // pragma: allowlist secret
    delete process.env.OPENAI_API_KEY;
    const client = createProviderAwareClient("test-openai", { ...mockBaseConfig, apiKey: "" }) as any;

    expect(client.config.apiKey).toBe("mock-aidha-openai-key"); // pragma: allowlist secret
  });

  it("should not reuse an unrelated profile apiKey for openai models", () => {
    const client = createProviderAwareClient("test-openai", {
      ...mockBaseConfig,
      apiKey: "AIza-mock-google-key", // pragma: allowlist secret
    }) as any;

    expect(client.config.apiKey).toBe("");
  });

  it("should override base URL for openai if base config has no URL", () => {
    process.env.OPENAI_API_KEY = "mock-openai-key"; // pragma: allowlist secret
    const emptyBase = { ...mockBaseConfig, baseUrl: "" };
    const client = createProviderAwareClient("test-openai", emptyBase) as any;

    expect(client.config.baseUrl).toBe("https://api.openai.com/v1");
  });

  it("should use Gemini API configuration for google-aistudio models", () => {
    process.env.GEMINI_API_KEY = "mock-gemini-key"; // pragma: allowlist secret
    const client = createProviderAwareClient("test-google-aistudio", mockBaseConfig) as any;

    expect(client.config.apiKey).toBe("mock-gemini-key"); // pragma: allowlist secret
    expect(client.config.baseUrl).toBe("https://generativelanguage.googleapis.com/v1beta");
  });

  it("should use AIDHA_GOOGLE_API_KEY for google-aistudio models", () => {
    process.env.AIDHA_GOOGLE_API_KEY = "mock-aidha-google-key"; // pragma: allowlist secret
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_AISTUDIO_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    const client = createProviderAwareClient("test-google-aistudio", { ...mockBaseConfig, apiKey: "" }) as any;

    expect(client.config.apiKey).toBe("mock-aidha-google-key"); // pragma: allowlist secret
  });

  it("should not reuse an unrelated profile apiKey for google-aistudio models", () => {
    const connection = resolveProviderConnection("test-google-aistudio", mockBaseConfig);

    expect(connection.apiKey).toBe("");
    expect(connection.baseUrl).toBe("https://generativelanguage.googleapis.com/v1beta");
  });

  it("should reuse an AIza-style apiKey for google-aistudio models", () => {
    const connection = resolveProviderConnection("test-google-aistudio", {
      ...mockBaseConfig,
      apiKey: "AIza-mock-google-key", // pragma: allowlist secret
    });

    expect(connection.apiKey).toBe("AIza-mock-google-key"); // pragma: allowlist secret
  });

  it("should not inherit the generic llm baseUrl for google-aistudio models", () => {
    process.env.GEMINI_API_KEY = "mock-gemini-key"; // pragma: allowlist secret
    const connection = resolveProviderConnection("test-google-aistudio", mockBaseConfig);

    expect(connection.baseUrl).toBe("https://generativelanguage.googleapis.com/v1beta");
  });

  it("should use ZAI_API_KEY for zai models", () => {
    process.env.ZAI_API_KEY = "mock-zai-key"; // pragma: allowlist secret
    const emptyBase = { ...mockBaseConfig, baseUrl: "" };
    const client = createProviderAwareClient("test-zai", emptyBase) as any;

    expect(client.config.apiKey).toBe("mock-zai-key"); // pragma: allowlist secret
    expect(client.config.baseUrl).toBe("https://api.zai.ai/v1");
  });

  it("should not reuse an unrelated profile apiKey for zai models", () => {
    const connection = resolveProviderConnection("test-zai", mockBaseConfig);

    expect(connection.apiKey).toBe("");
    expect(connection.baseUrl).toBe("https://api.zai.ai/v1");
  });

  it("should reuse a zai-shaped apiKey for zai models", () => {
    const connection = resolveProviderConnection("test-zai", {
      ...mockBaseConfig,
      apiKey: "zai-mock-key", // pragma: allowlist secret
    });

    expect(connection.apiKey).toBe("zai-mock-key"); // pragma: allowlist secret
  });

  it("should use XIAOMI_API_KEY for xiaomi models and respect explicit baseUrl", () => {
    process.env.XIAOMI_API_KEY = "mock-xiaomi-key"; // pragma: allowlist secret
    const emptyBase = { ...mockBaseConfig, baseUrl: "" };
    const client = createProviderAwareClient("test-xiaomi", emptyBase) as any;

    expect(client.config.apiKey).toBe("mock-xiaomi-key"); // pragma: allowlist secret
    // Model has explicit baseUrl, should use that
    expect(client.config.baseUrl).toBe("https://custom.xiaomi.com");
  });

  it("should not reuse an unrelated profile apiKey for xiaomi models", () => {
    const connection = resolveProviderConnection("test-xiaomi", mockBaseConfig);

    expect(connection.apiKey).toBe("");
    expect(connection.baseUrl).toBe("https://custom.xiaomi.com");
  });

  it("should reuse a xiaomi-shaped apiKey for xiaomi models", () => {
    const connection = resolveProviderConnection("test-xiaomi", {
      ...mockBaseConfig,
      apiKey: "xiaomi-mock-key", // pragma: allowlist secret
    });

    expect(connection.apiKey).toBe("xiaomi-mock-key"); // pragma: allowlist secret
  });

  it("should use OPENROUTER_API_KEY for openrouter models", () => {
    process.env.OPENROUTER_API_KEY = "mock-openrouter-key"; // pragma: allowlist secret
    const emptyBase = { ...mockBaseConfig, baseUrl: "" };
    const client = createProviderAwareClient("test-openrouter", emptyBase) as any;

    expect(client.config.apiKey).toBe("mock-openrouter-key"); // pragma: allowlist secret
    expect(client.config.baseUrl).toBe("https://openrouter.ai/api/v1");
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
