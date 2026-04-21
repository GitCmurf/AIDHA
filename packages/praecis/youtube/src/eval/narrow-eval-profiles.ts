export type NarrowEvalChunkMode =
  | "whole-transcript"
  | "large-request"
  | "medium-request"
  | "small-request";

export interface NarrowEvalModelProfile {
  chunkStrategy: "whole-transcript" | "semantic-overlap";
  targetInputTokens: number;
  hardMaxInputTokens: number;
  overlapExcerpts: number;
  requestTimeoutMs: number;
}

const CHUNK_MODES: readonly NarrowEvalChunkMode[] = [
  "whole-transcript",
  "large-request",
  "medium-request",
  "small-request",
] as const;

const MODE_DEFAULTS: Record<NarrowEvalChunkMode, NarrowEvalModelProfile> = {
  "whole-transcript": {
    chunkStrategy: "whole-transcript",
    targetInputTokens: 64_000,
    hardMaxInputTokens: 96_000,
    overlapExcerpts: 0,
    requestTimeoutMs: 120_000,
  },
  "large-request": {
    chunkStrategy: "semantic-overlap",
    targetInputTokens: 12_000,
    hardMaxInputTokens: 14_000,
    overlapExcerpts: 1,
    requestTimeoutMs: 120_000,
  },
  "medium-request": {
    chunkStrategy: "semantic-overlap",
    targetInputTokens: 8_000,
    hardMaxInputTokens: 9_000,
    overlapExcerpts: 1,
    requestTimeoutMs: 120_000,
  },
  "small-request": {
    chunkStrategy: "semantic-overlap",
    targetInputTokens: 4_000,
    hardMaxInputTokens: 5_000,
    overlapExcerpts: 1,
    requestTimeoutMs: 120_000,
  },
};

const MODEL_OVERRIDES: Partial<Record<NarrowEvalChunkMode, Record<string, Partial<NarrowEvalModelProfile>>>> = {
  "small-request": {
    "gpt-4o-mini": {
      targetInputTokens: 3_500,
      hardMaxInputTokens: 4_500,
    },
    "gemini-3.1-flash-lite-preview": {
      targetInputTokens: 4_500,
      hardMaxInputTokens: 5_500,
    },
  },
};

export function getNarrowEvalChunkModes(): readonly NarrowEvalChunkMode[] {
  return CHUNK_MODES;
}

export function getNarrowEvalModelProfile(modelId: string, mode: NarrowEvalChunkMode = "medium-request"): NarrowEvalModelProfile {
  return {
    ...MODE_DEFAULTS[mode],
    ...(MODEL_OVERRIDES[mode]?.[modelId] ?? {}),
  };
}
