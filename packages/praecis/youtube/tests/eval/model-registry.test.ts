import { describe, it, expect } from "vitest";
import { MODEL_REGISTRY, getModel } from "../../src/eval/model-registry";

describe("Model Registry", () => {
  it("should contain at least 10 models across 4 providers", () => {
    expect(MODEL_REGISTRY.length).toBeGreaterThanOrEqual(10);
    const providers = new Set(MODEL_REGISTRY.map(m => m.provider));
    expect(providers.size).toBeGreaterThanOrEqual(4);
  });

  it("should have non-empty id and provider for each model", () => {
    MODEL_REGISTRY.forEach(m => {
      expect(m.id).toBeTruthy();
      expect(typeof m.id).toBe("string");
      expect(m.provider).toBeTruthy();
      expect(typeof m.provider).toBe("string");
    });
  });

  it("should retrieve an OpenAI model by id", () => {
    const model = getModel("gpt-5.4");
    expect(model).toBeDefined();
    expect(model?.id).toBe("gpt-5.4");
    expect(model?.provider).toBe("openai");
  });

  it("should retrieve a Google AI Studio model by id", () => {
    const model = getModel("gemini-3.1-pro-preview");
    expect(model).toBeDefined();
    expect(model?.id).toBe("gemini-3.1-pro-preview");
    expect(model?.provider).toBe("google-aistudio");
  });

  it("should retrieve a z.AI model by id", () => {
    const model = getModel("glm-4.7");
    expect(model).toBeDefined();
    expect(model?.id).toBe("glm-4.7");
    expect(model?.provider).toBe("zai");
  });

  it("should retrieve a Xiaomi model by id", () => {
    const model = getModel("mimo-v2-flash");
    expect(model).toBeDefined();
    expect(model?.id).toBe("mimo-v2-flash");
    expect(model?.provider).toBe("xiaomi");
  });

  it("should return undefined for unknown model", () => {
    const model = getModel("unknown-model-xyz");
    expect(model).toBeUndefined();
  });
});
