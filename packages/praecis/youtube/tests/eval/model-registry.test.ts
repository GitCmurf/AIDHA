import { describe, it, expect } from "vitest";
import { MODEL_REGISTRY, getModel } from "../../src/eval/model-registry";

describe("Model Registry", () => {
  it("should contain at least 8 models across 3 providers", () => {
    expect(MODEL_REGISTRY.length).toBeGreaterThanOrEqual(8);
    const providers = new Set(MODEL_REGISTRY.map(m => m.provider));
    expect(providers.size).toBeGreaterThanOrEqual(3);
  });

  it("should have non-empty id and provider for each model", () => {
    MODEL_REGISTRY.forEach(m => {
      expect(m.id).toBeTruthy();
      expect(typeof m.id).toBe("string");
      expect(m.provider).toBeTruthy();
      expect(typeof m.provider).toBe("string");
    });
  });

  it("should retrieve a model by id", () => {
    const model = getModel("gpt-4o");
    expect(model).toBeDefined();
    expect(model?.id).toBe("gpt-4o");
  });

  it("should return undefined for unknown model", () => {
    const model = getModel("unknown-model-xyz");
    expect(model).toBeUndefined();
  });
});
