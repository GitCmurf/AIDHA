export type ModelTier = "frontier" | "midtier" | "budget";
export type ModelAvailability = "stable" | "experimental" | "free-tier";
export type ModelProvider = "openai" | "google-aistudio" | "zai" | "xiaomi";

export interface EvalModel {
  id: string;
  provider: ModelProvider;
  baseUrl?: string;
  modelName: string;
  contextWindow: number;
  supportsJsonMode: boolean;
  costPer1kTokens: {
    input: number;
    output: number;
  };
  notes?: string;
  tier: ModelTier;
  availability: ModelAvailability;
}

export const MODEL_REGISTRY: readonly EvalModel[] = [
  // ─────────────────────────────────────────────────────────────────────────────
  // OpenAI (direct API)
  // ─────────────────────────────────────────────────────────────────────────────
  // ─────────────────────────────────────────────────────────────────────────────
  // ⚠️ SPECULATIVE/FORWARD-LOOKING ENTRIES
  // The following GPT-5 model IDs and pricing are placeholders that must be
  // verified against the OpenAI API before production use. These entries are
  // included for planning purposes but may cause runtime errors if the API
  // does not recognize the IDs, and pricing may differ from actual rates.
  // ─────────────────────────────────────────────────────────────────────────────
  {
    id: "gpt-5.4",
    provider: "openai",
    modelName: "GPT-5.4",
    contextWindow: 128000,
    supportsJsonMode: true,
    costPer1kTokens: { input: 0.005, output: 0.015 },
    tier: "frontier",
    availability: "experimental",
    notes: "PLACEHOLDER: Verify ID and pricing before use",
  },
  {
    id: "gpt-5-mini",
    provider: "openai",
    modelName: "GPT-5-mini",
    contextWindow: 128000,
    supportsJsonMode: true,
    costPer1kTokens: { input: 0.0005, output: 0.0015 },
    tier: "midtier",
    availability: "experimental",
    notes: "PLACEHOLDER: Verify ID and pricing before use",
  },
  {
    id: "gpt-4o-mini",
    provider: "openai",
    modelName: "GPT-4o-mini",
    contextWindow: 128000,
    supportsJsonMode: true,
    costPer1kTokens: { input: 0.00015, output: 0.0006 },
    tier: "budget",
    availability: "stable",
  },
  {
    id: "gpt-5-nano",
    provider: "openai",
    modelName: "GPT-5-nano",
    contextWindow: 128000,
    supportsJsonMode: true,
    costPer1kTokens: { input: 0.00005, output: 0.0002 },
    tier: "budget",
    availability: "experimental",
    notes: "PLACEHOLDER: Verify ID and pricing before use",
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Google AI Studio (direct API)
  // ─────────────────────────────────────────────────────────────────────────────
  {
    id: "gemini-3.1-pro-preview",
    provider: "google-aistudio",
    modelName: "Gemini 3.1 Pro Preview",
    contextWindow: 2000000,
    supportsJsonMode: true,
    costPer1kTokens: { input: 0.0035, output: 0.0105 },
    tier: "frontier",
    availability: "stable",
    notes: "Latest Gemini 3.1 Pro via Google AI Studio",
  },
  {
    id: "gemini-3-flash-preview",
    provider: "google-aistudio",
    modelName: "Gemini 3 Flash Preview",
    contextWindow: 1000000,
    supportsJsonMode: true,
    costPer1kTokens: { input: 0.00015, output: 0.0006 },
    tier: "frontier",
    availability: "experimental",
    notes: "Gemini 3 Flash via Google AI Studio",
  },
  {
    id: "gemini-3.1-flash-lite-preview",
    provider: "google-aistudio",
    modelName: "Gemini 3.1 Flash Lite Preview",
    contextWindow: 1000000,
    supportsJsonMode: true,
    costPer1kTokens: { input: 0.000075, output: 0.0003 },
    tier: "budget",
    availability: "experimental",
    notes: "Lightweight Gemini 3.1 Flash via Google AI Studio",
  },
  {
    id: "gemini-2.5-flash",
    provider: "google-aistudio",
    modelName: "Gemini 2.5 Flash",
    contextWindow: 1000000,
    supportsJsonMode: true,
    costPer1kTokens: { input: 0.0001, output: 0.0004 },
    tier: "midtier",
    availability: "stable",
    notes: "Via Google AI Studio",
  },
  {
    id: "gemini-2.5-flash-lite",
    provider: "google-aistudio",
    modelName: "Gemini 2.5 Flash Lite",
    contextWindow: 1000000,
    supportsJsonMode: true,
    costPer1kTokens: { input: 0.00005, output: 0.0002 },
    tier: "budget",
    availability: "stable",
    notes: "Via Google AI Studio",
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // z.AI (GLM models)
  // ─────────────────────────────────────────────────────────────────────────────
  {
    id: "glm-4.7",
    provider: "zai",
    modelName: "GLM-4.7",
    contextWindow: 128000,
    supportsJsonMode: true,
    costPer1kTokens: { input: 0.0005, output: 0.0005 },
    tier: "frontier",
    availability: "experimental",
    notes: "Latest GLM model via z.AI",
  },
  {
    id: "glm-4.5-air",
    provider: "zai",
    modelName: "GLM-4.5-Air",
    contextWindow: 128000,
    supportsJsonMode: true,
    costPer1kTokens: { input: 0.0001, output: 0.0001 },
    tier: "budget",
    availability: "stable",
    notes: "Lightweight GLM via z.AI",
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Xiaomi (MiMo models)
  // ─────────────────────────────────────────────────────────────────────────────
  {
    id: "mimo-v2-flash",
    provider: "xiaomi",
    modelName: "MiMo-V2-Flash",
    contextWindow: 128000,
    supportsJsonMode: true,
    costPer1kTokens: { input: 0.0001, output: 0.0001 },
    tier: "budget",
    availability: "experimental",
    notes: "Xiaomi's MiMo V2 Flash model",
  },
] as const;

export function getModel(id: string): EvalModel | undefined {
  return MODEL_REGISTRY.find(m => m.id === id);
}
