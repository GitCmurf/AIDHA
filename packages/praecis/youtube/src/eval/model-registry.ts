export type ModelTier = "frontier" | "midtier" | "budget";
export type ModelAvailability = "stable" | "experimental" | "free-tier";

export interface EvalModel {
  id: string;
  provider: string;
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

export const MODEL_REGISTRY: EvalModel[] = [
  {
    id: "gpt-4o",
    provider: "openai",
    modelName: "GPT-4o",
    contextWindow: 128000,
    supportsJsonMode: true,
    costPer1kTokens: { input: 0.005, output: 0.015 },
    tier: "frontier",
    availability: "stable",
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
    id: "claude-3-5-sonnet",
    provider: "anthropic",
    modelName: "Claude 3.5 Sonnet",
    contextWindow: 200000,
    supportsJsonMode: true,
    costPer1kTokens: { input: 0.003, output: 0.015 },
    tier: "midtier",
    availability: "stable",
  },
  {
    id: "claude-3-opus",
    provider: "anthropic",
    modelName: "Claude 3 Opus",
    contextWindow: 200000,
    supportsJsonMode: true,
    costPer1kTokens: { input: 0.015, output: 0.075 },
    tier: "frontier",
    availability: "stable",
  },
  {
    id: "gemini-1.5-pro",
    provider: "google",
    modelName: "Gemini 1.5 Pro",
    contextWindow: 2000000,
    supportsJsonMode: true,
    costPer1kTokens: { input: 0.0035, output: 0.0105 },
    tier: "frontier",
    availability: "stable",
  },
  {
    id: "gemini-1.5-flash",
    provider: "google",
    modelName: "Gemini 1.5 Flash",
    contextWindow: 1000000,
    supportsJsonMode: true,
    costPer1kTokens: { input: 0.000075, output: 0.0003 },
    tier: "budget",
    availability: "stable",
  },
  {
    id: "llama-3-70b-instruct",
    provider: "meta",
    modelName: "Llama 3 70B Instruct",
    contextWindow: 8192,
    supportsJsonMode: false,
    costPer1kTokens: { input: 0.0005, output: 0.0005 },
    tier: "midtier",
    availability: "stable",
  },
  {
    id: "deepseek-r1",
    provider: "deepseek",
    modelName: "DeepSeek R1",
    contextWindow: 64000,
    supportsJsonMode: true,
    costPer1kTokens: { input: 0.00014, output: 0.00028 },
    tier: "budget",
    availability: "experimental",
  },
];

export function getModel(id: string): EvalModel | undefined {
  return MODEL_REGISTRY.find(m => m.id === id);
}
