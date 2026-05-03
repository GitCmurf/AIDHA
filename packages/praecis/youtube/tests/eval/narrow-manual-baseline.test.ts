import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  NarrowCorpusSchema,
  assessStructuralTargets,
  buildCorpusSignature,
  buildStageInputSignature,
  buildExtractionStageInputSignature,
  buildVideoScoreInputSignature,
  buildHarnessComparableClaimSet,
  computeOptimizationScore,
  computeGoldCoverage,
  computeCoverageByMode,
  buildComparableCandidateId,
  needsFallbackForModel,
  profileTranscriptStructure,
  renderNarrowComparisonMarkdown,
  runNarrowManualBaselineComparison,
  selectShortlistCandidatesForVideo,
  selectFastTriageEscalationPack,
  shouldFastTriageEscalate,
  type EmbeddingBudgetState,
} from "../../src/eval/narrow-manual-baseline";
import { isOpenAiBaseUrl } from "../../src/utils/urls.js";
import { validateSafeId } from "../../src/utils/ids.js";

const { geminiEmbeddingClientMock } = vi.hoisted(() => ({
  geminiEmbeddingClientMock: vi.fn().mockImplementation(() => ({
    similarity: vi.fn().mockResolvedValue({ ok: true, value: { score: 0.99, ok: true } }),
    prewarm: vi.fn(),
    getApiRequestCount: vi.fn().mockReturnValue(1),
    getStats: vi.fn().mockReturnValue({
      apiRequestCount: 1,
      cacheHitCount: 0,
      cacheMissCount: 0,
    }),
  })),
}));

vi.mock("../../src/eval/matrix-runner.js", () => ({
  runEvaluationMatrix: vi.fn().mockImplementation(async (_corpus, _models, options) => {
    const isSelfImprove = options.variants?.includes("self-improve-v1");
    return {
      cells: [
        {
          videoId: "video-1",
          modelId: "model-1",
          extractorVariantId: options.variants?.[0] ?? "raw",
          chunkMode: options.extractionChunkModeId,
          promptConfigId: options.extractionPromptConfigId,
          claimSet: isSelfImprove
            ? [
                {
                  text: "There are five slide layouts.",
                  excerptIds: ["e1"],
                  type: "fact",
                  confidence: 0.9,
                  why: "matches the transcript",
                  method: "llm",
                  state: "accepted",
                },
                {
                  text: "Avoid pie charts when comparing shares.",
                  excerptIds: ["e2"],
                  type: "recommendation",
                  confidence: 0.9,
                  why: "matches the transcript",
                  method: "llm",
                  state: "accepted",
                },
              ]
            : [
                {
                  text: "There are five slide layouts.",
                  excerptIds: ["e1"],
                  type: "fact",
                  confidence: 0.9,
                  why: "matches the transcript",
                  method: "llm",
                  state: "accepted",
                },
              ],
          extractionDiagnostics: {
            transportRetryCount: 0,
            fallbackChunkCount: 0,
            transientFailureCount: 0,
            clientTimeoutCount: 0,
            upstreamAbortCount: 0,
            chunkInputTokenCounts: [],
            maxChunkInputTokens: 0,
            selfImproveRoundCount: isSelfImprove ? 1 : 0,
            promptPackId: options.extractionPromptPackId ?? "generic-hierarchy",
            routeSource: "mock",
            routeConfidence: 1,
            routeSignals: [],
            retryTriggered: false,
          },
        },
      ],
      metadata: {
        startedAt: "2026-05-03T00:00:00.000Z",
        completedAt: "2026-05-03T00:00:01.000Z",
        config: {},
        failedCellCount: 0,
        partialFailureCount: 0,
      },
    };
  }),
}));

vi.mock("../../src/eval/gemini-embedding-client.js", () => ({
  GeminiEmbeddingClient: geminiEmbeddingClientMock,
}));

describe("narrow-manual-baseline helpers", () => {
  it("computes root and child gold coverage separately", async () => {
    const coverage = await computeGoldCoverage(
      [
        { text: "Primary claim", excerptIds: ["e1"] },
        { text: "Supporting detail", excerptIds: ["e2"] },
      ],
      [
        { id: "video:1", parentId: undefined, depth: 0, path: [1], text: "Primary claim", type: "fact", evidence: undefined },
        { id: "video:1.1", parentId: "video:1", depth: 1, path: [1, 1], text: "Supporting detail", type: "fact", evidence: undefined },
        { id: "video:1.2", parentId: "video:1", depth: 1, path: [1, 2], text: "Missed child", type: "fact", evidence: undefined },
      ]
    );

    expect(coverage.matched).toBe(2);
    expect(coverage.total).toBe(3);
    expect(coverage.rootsMatched).toBe(1);
    expect(coverage.rootsTotal).toBe(1);
    expect(coverage.childrenMatched).toBe(1);
    expect(coverage.childrenTotal).toBe(2);
    expect(coverage.unmatchedGoldClaims).toEqual([
      { id: "video:1.2", text: "Missed child", depth: 1 },
    ]);
  });

  it("detects when a model should trigger fallback", () => {
    expect(needsFallbackForModel([
      {
        videoId: "v1",
        modelId: "gpt-5.4",
        extractorVariantId: "raw",
        claimSet: [],
        error: { message: "LLM request failed (404): model not found" },
      },
      {
        videoId: "v1",
        modelId: "gpt-5.4",
        extractorVariantId: "editorial-pass-v1",
        claimSet: [],
        error: { message: "Unknown model" },
      },
    ], "gpt-5.4")).toBe(true);
  });

  it("detects heuristic-fallback-only rows as requiring fallback", () => {
    expect(needsFallbackForModel([
      {
        videoId: "v1",
        modelId: "gpt-5.4",
        extractorVariantId: "raw",
        claimSet: [
          {
            text: "Fallback claim",
            excerptIds: ["e1"],
            method: "heuristic-fallback",
          },
        ],
      },
    ], "gpt-5.4")).toBe(true);
  });

  it("detects quota-exhausted rows as requiring fallback", () => {
    expect(needsFallbackForModel([
      {
        videoId: "v1",
        modelId: "gemini-3.1-pro-preview",
        extractorVariantId: "raw",
        claimSet: [],
        error: { message: "Gemini request failed (429): quota exceeded" },
      },
    ], "gemini-3.1-pro-preview")).toBe(true);
  });

  it("renders a markdown summary table for candidate rows", () => {
    const coverage = {
      matched: 2,
      total: 3,
      ratio: 2 / 3,
      rootsMatched: 1,
      rootsTotal: 1,
      rootRatio: 1,
      childrenMatched: 1,
      childrenTotal: 2,
      childRatio: 0.5,
      unmatchedGoldClaims: [],
      unmatchedCandidateClaims: [],
      matchedPairs: [],
      nearestMisses: [],
    };
    const markdown = renderNarrowComparisonMarkdown({
      metadata: {
        startedAt: "2026-03-15T00:00:00.000Z",
        completedAt: "2026-03-15T00:01:00.000Z",
        runMode: "fast-triage",
        judgeModelIds: ["glm-5-openrouter", "gpt-4o-mini"],
        requestedModels: ["gemini-3.1-pro-preview", "gpt-5.4"],
        chunkModes: ["whole-transcript", "medium-request", "small-request"],
        promptConfigs: ["baseline", "hierarchy-first", "enumeration-first"],
        variants: ["raw", "editorial-pass-v1"],
        teacherSelectionMode: "manual-baseline-best-by-gold-coverage",
        judgedTopHarnessPerVideo: 3,
        fallbackModelId: "gpt-5-mini",
        fallbackTriggeredFor: ["gpt-5.4"],
        manualBaselineDir: "out/eval-matrix/manual-baseline",
        transcriptDir: "out/eval-matrix/transcripts",
        shortlistSizePerVideo: 2,
        refinedTargetCount: 2,
        embeddingModel: "gemini-embedding-2-preview",
        completedStages: ["shortlist", "refine", "score", "judge", "report"],
        budgetSkips: [],
        stageExecution: {
          shortlist: "recomputed",
          refine: "resumed",
          score: "recomputed",
          judge: "skipped",
          report: "recomputed",
        },
        judgeEnabled: true,
        manualBaselinesIncluded: true,
        apiCallCounts: {
          embeddingRequests: 2,
          embeddingCacheHits: 4,
          embeddingCacheMisses: 2,
        },
        rateLimitStatsByModel: {
          "gpt-5.4": { requests: 2, waitMs: 0 },
        },
      },
      videos: [
        {
          videoId: "v1",
          title: "Video 1",
          transcriptStructureProfile: {
            tags: ["finite-set", "recommendation"],
            cueMatches: ["five layouts", "avoid"],
          },
          candidateReports: [
            {
              candidateId: "manual/CG",
              sourceKind: "manual-baseline",
              claimCount: 3,
              rankWithinVideo: 1,
              teacherCandidateId: "manual/GG",
              teacherCoverage: coverage,
              gapSummary: {
                missingGoldRoots: [],
                missingGoldFrameworkClaims: [],
                missingTeacherClaims: [],
                extraCandidateClaims: [],
              },
              derivedScoresByModel: {
                "glm-5-openrouter": {
                  overallScore: 8.5,
                  goldCoverage: 8,
                  faithfulness: 9,
                  structure: 8,
                  atomicity: 9,
                },
              },
              strictCoverage: coverage,
              semanticCoverage: coverage,
              embeddingCoverage: coverage,
              goldCoverage: coverage,
            },
          ],
        },
      ],
    });

    expect(markdown).toContain("# Narrow Manual Baseline Comparison");
    expect(markdown).toContain("manual/CG");
    expect(markdown).toContain("0.67");
    expect(markdown).toContain("Prompt configs");
    expect(markdown).toContain("Teacher");
    expect(markdown).toContain("Stage execution");
    expect(markdown).toContain("Transcript structure");
    expect(markdown).toContain("five layouts");
  });

  it("escalates weak consulting candidates to the enumeration v2 pack", () => {
    const weakCoverage = {
      matched: 1,
      total: 5,
      ratio: 0.2,
      rootsMatched: 0,
      rootsTotal: 1,
      rootRatio: 0,
      childrenMatched: 1,
      childrenTotal: 4,
      childRatio: 0.25,
      unmatchedGoldClaims: [],
      unmatchedCandidateClaims: [],
      matchedPairs: [],
      nearestMisses: [],
    };

    expect(shouldFastTriageEscalate({
      semanticCoverage: weakCoverage,
      diagnostics: {
        timeoutSource: "none",
        retryCount: 0,
        fallbackKind: "none",
        transientFailureCount: 0,
        clientTimeoutCount: 0,
        upstreamAbortCount: 0,
        maxChunkInputTokens: 0,
        chunkInputTokenCounts: [],
        selfImproveRoundCount: 0,
        promptPackId: "enumeration-framework",
        retryReason: "missing-root-claim",
      },
    })).toBe(true);

    expect(selectFastTriageEscalationPack({
      topicDomain: "Business strategy",
      semanticCoverage: weakCoverage,
      diagnostics: {
        timeoutSource: "none",
        retryCount: 0,
        fallbackKind: "none",
        transientFailureCount: 0,
        clientTimeoutCount: 0,
        upstreamAbortCount: 0,
        maxChunkInputTokens: 0,
        chunkInputTokenCounts: [],
        selfImproveRoundCount: 0,
        promptPackId: "enumeration-framework",
        retryReason: "missing-root-claim",
      },
    })).toBe("enumeration-framework-v2");
  });

  it("escalates weak clinical candidates to the clinical v2 pack", () => {
    const weakCoverage = {
      matched: 1,
      total: 6,
      ratio: 1 / 6,
      rootsMatched: 0,
      rootsTotal: 1,
      rootRatio: 0,
      childrenMatched: 1,
      childrenTotal: 5,
      childRatio: 0.2,
      unmatchedGoldClaims: [],
      unmatchedCandidateClaims: [],
      matchedPairs: [],
      nearestMisses: [],
    };

    expect(selectFastTriageEscalationPack({
      topicDomain: "Clinical cardiology",
      semanticCoverage: weakCoverage,
      diagnostics: {
        timeoutSource: "none",
        retryCount: 0,
        fallbackKind: "none",
        transientFailureCount: 0,
        clientTimeoutCount: 0,
        upstreamAbortCount: 0,
        maxChunkInputTokens: 0,
        chunkInputTokenCounts: [],
        selfImproveRoundCount: 0,
        promptPackId: "clinical-risk-management",
        retryReason: "missing-root-claim",
      },
    })).toBe("clinical-risk-management-v2");
  });

  it("uses the same extraction-stage signature for fast-triage and compare", async () => {
    const common = {
      corpus: [
        {
          videoId: "RfEOrbbMwMU",
          url: "https://youtube.com/watch?v=RfEOrbbMwMU",
          title: "Video 1",
          channelName: "Channel 1",
          durationMinutes: 10,
          topicDomain: "Business strategy",
          expectedClaimDensity: "medium",
          rationale: "test",
        },
        {
          videoId: "xZzkNJ0e5J0",
          url: "https://youtube.com/watch?v=xZzkNJ0e5J0",
          title: "Video 2",
          channelName: "Channel 2",
          durationMinutes: 20,
          topicDomain: "Clinical cardiology",
          expectedClaimDensity: "high",
          rationale: "test",
        },
      ],
      modelIds: ["gemini-3.1-flash-lite-preview"],
      chunkModes: ["large-request"] as const,
      promptConfigs: ["baseline", "hierarchy-first", "enumeration-first"] as const,
      stage1Variants: ["raw"] as const,
      stage2Variants: ["self-improve-v1"] as const,
      transcriptDir: "/tmp/transcripts",
      manualBaselineDir: "/tmp/manual",
      fallbackModelId: "gemini-3.1-flash-lite-preview",
      judgeModelIds: ["gpt-4o-mini"],
      judgeMaxTokens: 4000,
      enablePromptRouting: false,
      embeddingClientAvailable: false,
    };
    const corpusSignature = buildCorpusSignature(common.corpus as any);
    const signedCommon = {
      ...common,
      corpusSignature,
      corpus: common.corpus as any,
    };
    const reversedCorpus = [...common.corpus].reverse();
    const reversedSignedCommon = {
      ...common,
      corpusSignature: buildCorpusSignature(reversedCorpus as any),
      corpus: reversedCorpus as any,
    };

    expect(await buildExtractionStageInputSignature(signedCommon as any)).toBe(
      await buildExtractionStageInputSignature(reversedSignedCommon as any)
    );
  });

  it("disambiguates refined harness candidate ids from the shortlist row", () => {
    const cell = {
      modelId: "gpt-5.4",
      extractorVariantId: "self-improve-v1",
      promptConfigId: "baseline",
      chunkMode: "large-request",
      claimSet: [
        {
          text: "There are five slide layouts.",
          excerptIds: ["e1"],
          type: "fact",
          confidence: 0.9,
          why: "matches the transcript",
          method: "llm",
          state: "accepted",
        },
      ],
      extractionDiagnostics: {
        promptPackId: "prompt-pack-a",
      },
    };
    const refinedCell = {
      ...cell,
      refinementStage: "refined" as const,
    };

    expect(buildComparableCandidateId(cell as any, "harness")).toBe(
      "harness/gpt-5.4/self-improve-v1/baseline/large-request/prompt-pack-a"
    );
    expect(buildComparableCandidateId(refinedCell as any, "harness")).toBe(
      "harness/gpt-5.4/self-improve-v1/baseline/large-request/prompt-pack-a/refine"
    );
    expect(buildComparableCandidateId(cell as any, "harness")).not.toBe(
      buildComparableCandidateId(refinedCell as any, "harness")
    );

    const shortlistedComparable = buildHarnessComparableClaimSet(cell as any);
    const refinedComparable = buildHarnessComparableClaimSet(refinedCell as any);
    const candidateById = new Map([
      [shortlistedComparable.candidateId, shortlistedComparable],
      [refinedComparable.candidateId, refinedComparable],
    ]);

    expect(candidateById.size).toBe(2);
    expect(candidateById.get(shortlistedComparable.candidateId)).toBe(shortlistedComparable);
    expect(candidateById.get(refinedComparable.candidateId)).toBe(refinedComparable);
  });

  it("preserves refined harness candidate ids after JSON rehydration", () => {
    const cell = {
      videoId: "video-1",
      modelId: "gpt-5.4",
      extractorVariantId: "self-improve-v1",
      promptConfigId: "baseline",
      chunkMode: "large-request",
      claimSet: [
        {
          text: "There are five slide layouts.",
          excerptIds: ["e1"],
          type: "fact",
          confidence: 0.9,
          why: "matches the transcript",
          method: "llm",
          state: "accepted",
        },
      ],
      extractionDiagnostics: {
        promptPackId: "prompt-pack-a",
      },
      refinementStage: "refined" as const,
    };
    const rehydratedCell = JSON.parse(JSON.stringify(cell));
    const comparableClaimSet = buildHarnessComparableClaimSet(rehydratedCell as any);
    const candidateById = new Map([[comparableClaimSet.candidateId, comparableClaimSet]]);

    expect(comparableClaimSet.candidateId).toBe(
      "harness/gpt-5.4/self-improve-v1/baseline/large-request/prompt-pack-a/refine"
    );
    expect(candidateById.get("harness/gpt-5.4/self-improve-v1/baseline/large-request/prompt-pack-a/refine")).toBe(
      comparableClaimSet
    );
  });

  it("changes the extraction-stage signature when corpus metadata changes", async () => {
    const baseCorpus = [
      {
        videoId: "RfEOrbbMwMU",
        url: "https://youtube.com/watch?v=RfEOrbbMwMU",
        title: "Video 1",
        channelName: "Channel 1",
        durationMinutes: 10,
        topicDomain: "Business strategy",
        expectedClaimDensity: "medium" as const,
        rationale: "test",
      },
    ];

    const changedCorpus = [
      {
        ...baseCorpus[0],
        topicDomain: "Clinical cardiology",
      },
    ];

    const common = {
      modelIds: ["gemini-3.1-flash-lite-preview"],
      chunkModes: ["large-request"] as const,
      promptConfigs: ["baseline", "hierarchy-first", "enumeration-first"] as const,
      stage1Variants: ["raw"] as const,
      stage2Variants: ["self-improve-v1"] as const,
      transcriptDir: "/tmp/transcripts",
      manualBaselineDir: "/tmp/manual",
      fallbackModelId: "gemini-3.1-flash-lite-preview",
      judgeModelIds: ["gpt-4o-mini"],
      judgeMaxTokens: 4000,
      enablePromptRouting: false,
    };

    const baseSignature = await buildExtractionStageInputSignature({
      ...common,
      corpusSignature: buildCorpusSignature(baseCorpus),
      corpus: baseCorpus as any,
    } as any);
    const changedSignature = await buildExtractionStageInputSignature({
      ...common,
      corpusSignature: buildCorpusSignature(changedCorpus),
      corpus: changedCorpus as any,
    } as any);

    expect(baseSignature).not.toBe(changedSignature);
  });

  it("changes the extraction-stage signature when embeddingBatchSize changes", async () => {
    const common = {
      corpusSignature: "test-sig",
      corpus: [],
      modelIds: ["test-model"],
      chunkModes: ["small-request"],
      promptConfigs: ["v1-minimal"],
      stage1Variants: ["raw"],
      stage2Variants: ["editorial-pass-v1"],
      transcriptDir: "test",
      manualBaselineDir: "test",
      fallbackModelId: "test",
      judgeModelIds: [],
      judgeMaxTokens: 4000,
      enablePromptRouting: false,
      embeddingClientAvailable: false,
      embeddingBatchSize: 20,
    };

    const sig1 = await buildExtractionStageInputSignature(common as any);
    const sig2 = await buildExtractionStageInputSignature({ ...common, embeddingBatchSize: 50 } as any);
    expect(sig1).not.toBe(sig2);
  });

  it("changes the extraction-stage signature when taskType changes", async () => {
    const common = {
      corpusSignature: "test-sig",
      corpus: [],
      modelIds: ["test-model"],
      chunkModes: ["small-request"],
      promptConfigs: ["v1-minimal"],
      stage1Variants: ["raw"],
      stage2Variants: ["editorial-pass-v1"],
      transcriptDir: "test",
      manualBaselineDir: "test",
      fallbackModelId: "test",
      judgeModelIds: [],
      judgeMaxTokens: 4000,
      enablePromptRouting: false,
      embeddingClientAvailable: false,
      taskType: "SEMANTIC_SIMILARITY",
    };

    const sig1 = await buildExtractionStageInputSignature(common as any);
    const sig2 = await buildExtractionStageInputSignature({ ...common, taskType: "RETRIEVAL_QUERY" } as any);
    expect(sig1).not.toBe(sig2);
  });

  it("changes the extraction-stage signature when outputDimensionality changes", async () => {
    const common = {
      corpusSignature: "test-sig",
      corpus: [],
      modelIds: ["test-model"],
      chunkModes: ["small-request"],
      promptConfigs: ["v1-minimal"],
      stage1Variants: ["raw"],
      stage2Variants: ["editorial-pass-v1"],
      transcriptDir: "test",
      manualBaselineDir: "test",
      fallbackModelId: "test",
      judgeModelIds: [],
      judgeMaxTokens: 4000,
      enablePromptRouting: false,
      embeddingClientAvailable: false,
      outputDimensionality: 768,
    };

    const sig1 = await buildExtractionStageInputSignature(common as any);
    const sig2 = await buildExtractionStageInputSignature({ ...common, outputDimensionality: 128 } as any);
    expect(sig1).not.toBe(sig2);
  });

  it("changes the stage signature when embedding client availability changes", async () => {
    const common = {
      corpusSignature: "test-sig",
      runMode: "compare" as const,
      corpus: [],
      modelIds: ["test-model"],
      chunkModes: ["small-request"],
      promptConfigs: ["v1-minimal"],
      stage1Variants: ["raw"],
      stage2Variants: ["editorial-pass-v1"],
      transcriptDir: "test",
      manualBaselineDir: "test",
      fallbackModelId: "test",
      judgeEnabled: true,
      judgeModelIds: [],
      judgeMaxTokens: 4000,
      includeManualBaselines: true,
      enablePromptRouting: false,
      maxEmbeddingRequestsPerRun: 25,
      embeddingClientAvailable: true,
    };

    const sig1 = await buildStageInputSignature(common as any);
    const sig2 = await buildStageInputSignature({ ...common, embeddingClientAvailable: false } as any);
    expect(sig1).not.toBe(sig2);
  });

  it("changes the per-video score signature when embedding inputs change", () => {
    const common = {
      corpusSignature: "test-corpus",
      runMode: "compare" as const,
      videoId: "video-1",
      includeManualBaselines: true,
      enableEmbeddings: true,
      embeddingClientAvailable: true,
      embeddingModel: "gemini-embedding-001",
      embeddingBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
      embeddingBatchSize: 20,
      maxEmbeddingRequestsPerRun: 100,
      taskType: "SEMANTIC_SIMILARITY",
      outputDimensionality: 768,
      goldClaims: [
        {
          id: "video-1:1",
          depth: 0,
          path: [1],
          text: "Primary claim",
          type: "fact",
        },
      ],
      comparableClaimSets: [
        {
          videoId: "video-1",
          candidateId: "harness/raw/baseline/small-request",
          sourceKind: "harness" as const,
          claims: [
            { text: "Primary claim", excerptIds: ["e1"] },
          ],
        },
      ],
    };

    const baseSignature = buildVideoScoreInputSignature(common);
    const changedInputs = [
      { embeddingModel: "gemini-embedding-002" },
      { embeddingBaseUrl: "https://example.test/v1beta" },
      { embeddingBatchSize: 50 },
      { maxEmbeddingRequestsPerRun: 25 },
      { taskType: "RETRIEVAL_QUERY" },
      { outputDimensionality: 128 },
      { embeddingClientAvailable: false },
    ];

    for (const changedInput of changedInputs) {
      expect(buildVideoScoreInputSignature({ ...common, ...changedInput }))
        .not.toBe(baseSignature);
    }
  });

  it("uses injected runtime env values for Gemini embeddings without process.env", async () => {
    const originalEnv = {
      GOOGLE_AISTUDIO_API_KEY: process.env.GOOGLE_AISTUDIO_API_KEY,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
      AIDHA_GOOGLE_API_KEY: process.env.AIDHA_GOOGLE_API_KEY,
      GOOGLE_EMBEDDING_MODEL: process.env.GOOGLE_EMBEDDING_MODEL,
      AIDHA_GOOGLE_EMBEDDING_MODEL: process.env.AIDHA_GOOGLE_EMBEDDING_MODEL,
      AIDHA_EVAL_EMBEDDING_MODEL: process.env.AIDHA_EVAL_EMBEDDING_MODEL,
      GOOGLE_EMBEDDING_BASE_URL: process.env.GOOGLE_EMBEDDING_BASE_URL,
      GOOGLE_EMBEDDING_TASK_TYPE: process.env.GOOGLE_EMBEDDING_TASK_TYPE,
      GOOGLE_EMBEDDING_OUTPUT_DIMENSIONALITY: process.env.GOOGLE_EMBEDDING_OUTPUT_DIMENSIONALITY,
    };

    try {
      delete process.env.GOOGLE_AISTUDIO_API_KEY;
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_API_KEY;
      delete process.env.AIDHA_GOOGLE_API_KEY;
      delete process.env.GOOGLE_EMBEDDING_MODEL;
      delete process.env.AIDHA_GOOGLE_EMBEDDING_MODEL;
      delete process.env.AIDHA_EVAL_EMBEDDING_MODEL;
      delete process.env.GOOGLE_EMBEDDING_BASE_URL;
      delete process.env.GOOGLE_EMBEDDING_TASK_TYPE;
      delete process.env.GOOGLE_EMBEDDING_OUTPUT_DIMENSIONALITY;
      geminiEmbeddingClientMock.mockClear();

      const rootDir = await mkdtemp(join(tmpdir(), "narrow-manual-baseline-env-"));
      const transcriptDir = await mkdtemp(join(rootDir, "transcripts-"));
      const manualBaselineDir = await mkdtemp(join(rootDir, "manual-"));
      const outputDir = await mkdtemp(join(rootDir, "output-"));

      await writeFile(
        join(transcriptDir, "video-1.json"),
        JSON.stringify({
          videoId: "video-1",
          fullText: "There are five slide layouts.",
          segments: [
            { start: 0, duration: 1, text: "There are five slide layouts." },
          ],
        })
      );
      await writeFile(
        join(manualBaselineDir, "video-1-gold-draft-v1.json"),
        JSON.stringify({
          videoId: "video-1",
          title: "Video 1",
          idealClaims: [
            {
              text: "There are five slide layouts.",
              type: "fact",
              children: [],
            },
          ],
          rejectedClaims: [],
        })
      );

      const report = await runNarrowManualBaselineComparison({
        corpus: [
          {
            videoId: "video-1",
            url: "https://youtube.com/watch?v=video-1",
            title: "Video 1",
            channelName: "Channel 1",
            durationMinutes: 1,
            topicDomain: "Business strategy",
            expectedClaimDensity: "low",
            rationale: "test",
          },
        ] as any,
        transcriptDir,
        manualBaselineDir,
        outputDir,
        models: [{ id: "model-1" }] as any,
        variants: ["raw"] as any,
        judgeModelIds: [],
        fallbackModelId: "model-1",
        config: {
          llm: {
            model: "gpt-4o-mini",
            apiKey: "",
            baseUrl: "",
            timeoutMs: 1000,
            cacheDir: "test-cache",
          },
        } as any,
        clientFactory: () => ({}) as any,
        runMode: "compare",
        includeManualBaselines: false,
        env: {
          AIDHA_GOOGLE_API_KEY: "from-dotenv-google", // pragma: allowlist secret
        } as NodeJS.ProcessEnv,
      });

      expect(geminiEmbeddingClientMock).toHaveBeenCalledTimes(1);
      expect(geminiEmbeddingClientMock).toHaveBeenCalledWith(expect.objectContaining({
        apiKey: "from-dotenv-google", // pragma: allowlist secret
        model: "gemini-embedding-2-preview",
      }));
      expect(report.metadata.embeddingModel).toBe("gemini-embedding-2-preview");
    } finally {
      for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  it("matches only OpenAI hostnames when detecting OpenAI base URLs", () => {
    expect(isOpenAiBaseUrl("https://api.openai.com/v1")).toBe(true);
    expect(isOpenAiBaseUrl("https://openai.com/v1")).toBe(true);
    expect(isOpenAiBaseUrl("https://evil-openai.com/v1")).toBe(false);
    expect(isOpenAiBaseUrl("https://openai.com.attacker.test/v1")).toBe(false);
    expect(isOpenAiBaseUrl("not a url")).toBe(false);
  });

  it("prefers escalated v2 finalists for shortlist selection when adaptive escalation fired", () => {
    const coverage = {
      matched: 2,
      total: 5,
      ratio: 0.4,
      rootsMatched: 0,
      rootsTotal: 1,
      rootRatio: 0,
      childrenMatched: 2,
      childrenTotal: 4,
      childRatio: 0.5,
      unmatchedGoldClaims: [],
      unmatchedCandidateClaims: [],
      matchedPairs: [],
      nearestMisses: [],
    };

    const selected = selectShortlistCandidatesForVideo({
      videoId: "RfEOrbbMwMU",
      title: "Consulting slides",
      candidateReports: [
        {
          candidateId: "harness/raw/baseline/large-request",
          sourceKind: "harness",
          claimCount: 6,
          rankWithinVideo: 1,
          semanticCoverage: coverage,
          strictCoverage: coverage,
          goldCoverage: coverage,
          diagnostics: { promptPackId: "generic-hierarchy" } as any,
        },
        {
          candidateId: "harness/raw/baseline/small-request",
          sourceKind: "harness",
          claimCount: 9,
          rankWithinVideo: 2,
          chunkMode: "small-request",
          promptConfigId: "baseline",
          semanticCoverage: coverage,
          strictCoverage: coverage,
          goldCoverage: coverage,
          diagnostics: { promptPackId: "enumeration-framework-v2" } as any,
        },
      ],
    }, 1, true);

    expect(selected.map((candidate) => candidate.candidateId)).toEqual([
      "harness/raw/baseline/small-request",
    ]);
  });

  it("profiles transcript structure for finite-set enumeration targets", () => {
    const profile = profileTranscriptStructure(
      "There are five slide layouts that cover most consulting pages. " +
      "Use the layouts carefully and avoid pie charts when presenting comparisons."
    );

    expect(profile).toMatchObject({
      tags: ["finite-set", "recommendation"],
      cueMatches: expect.arrayContaining(["five slide layouts", "avoid"]),
      finiteSet: {
        cardinalityTerms: ["five"],
        listNouns: ["layouts"],
        requiresAvoidRule: true,
      },
    });
  });

  it("profiles broader discourse structure cues from transcript text", () => {
    const profile = profileTranscriptStructure(
      "Lipoprotein(a) is a cholesterol particle with an attached protein. " +
      "The framework has four principles. First, optimize risk factors. " +
      "Second, lower LDL aggressively. Compared to LDL, Lp(a) is more genetic. " +
      "Patients should avoid assuming lifestyle alone will lower the lab value."
    );

    expect(profile.tags).toEqual(expect.arrayContaining([
      "definition-first",
      "framework",
      "process",
      "contrast",
      "recommendation",
    ]));
    expect(profile.cueMatches).toEqual(expect.arrayContaining([
      "is a",
      "framework",
      "first",
      "compared to",
      "should",
    ]));
  });

  it("rewards candidates that preserve finite-set structure and avoid rules", () => {
    const profile = profileTranscriptStructure(
      "There are five slide layouts that cover most consulting pages. " +
      "Avoid pie charts when comparing category shares."
    );

    const strongAssessment = assessStructuralTargets(
      [
        { text: "There are five slide layouts used for most consulting slides.", excerptIds: ["e1"] },
        { text: "The five layouts are single table, chart, subtitle, framework, and visual.", excerptIds: ["e2"] },
        { text: "Avoid pie charts when comparing category shares.", excerptIds: ["e3"] },
      ],
      profile
    );

    const weakAssessment = assessStructuralTargets(
      [
        { text: "Some layouts are common in consulting decks.", excerptIds: ["e1"] },
        { text: "Charts can help with comparisons.", excerptIds: ["e2"] },
      ],
      profile
    );

    expect(strongAssessment.score).toBeGreaterThan(weakAssessment.score);
    expect(strongAssessment.score).toBeGreaterThan(0.9);
    expect(strongAssessment.passesShortlistGate).toBe(true);
    expect(weakAssessment.score).toBe(0);
    expect(weakAssessment.passesShortlistGate).toBe(false);
  });

  it("uses structural target score in optimization ranking", () => {
    const coverage = {
      matched: 2,
      total: 5,
      ratio: 0.4,
      rootsMatched: 0,
      rootsTotal: 1,
      rootRatio: 0,
      childrenMatched: 2,
      childrenTotal: 4,
      childRatio: 0.5,
      unmatchedGoldClaims: [],
      unmatchedCandidateClaims: [],
      matchedPairs: [],
      nearestMisses: [],
    };

    const withStructure = computeOptimizationScore({
      candidateId: "harness/structured",
      sourceKind: "harness",
      claimCount: 3,
      structuralTargetScore: 1,
      semanticCoverage: coverage,
      strictCoverage: coverage,
      goldCoverage: coverage,
      diagnostics: {
        timeoutSource: "none",
        retryCount: 0,
        fallbackKind: "none",
        transientFailureCount: 0,
        clientTimeoutCount: 0,
        upstreamAbortCount: 0,
        maxChunkInputTokens: 3000,
        chunkInputTokenCounts: [],
        selfImproveRoundCount: 0,
      },
    });

    const withoutStructure = computeOptimizationScore({
      candidateId: "harness/flat",
      sourceKind: "harness",
      claimCount: 3,
      structuralTargetScore: 0,
      semanticCoverage: coverage,
      strictCoverage: coverage,
      goldCoverage: coverage,
      diagnostics: {
        timeoutSource: "none",
        retryCount: 0,
        fallbackKind: "none",
        transientFailureCount: 0,
        clientTimeoutCount: 0,
        upstreamAbortCount: 0,
        maxChunkInputTokens: 3000,
        chunkInputTokenCounts: [],
        selfImproveRoundCount: 0,
      },
    });

    expect(withStructure).toBeGreaterThan(withoutStructure ?? Number.NEGATIVE_INFINITY);
  });

  it("requires a root/cardinality claim before a finite-set candidate can win shortlist when any candidate has one", () => {
    const coverage = {
      matched: 2,
      total: 5,
      ratio: 0.4,
      rootsMatched: 0,
      rootsTotal: 1,
      rootRatio: 0,
      childrenMatched: 2,
      childrenTotal: 4,
      childRatio: 0.5,
      unmatchedGoldClaims: [],
      unmatchedCandidateClaims: [],
      matchedPairs: [],
      nearestMisses: [],
    };

    const selected = selectShortlistCandidatesForVideo({
      videoId: "RfEOrbbMwMU",
      title: "Consulting slides",
      candidateReports: [
        {
          candidateId: "harness/raw/baseline/small-request",
          sourceKind: "harness",
          claimCount: 8,
          rankWithinVideo: 1,
          chunkMode: "small-request",
          promptConfigId: "baseline",
          structuralTargetScore: 0.35,
          structuralTargetAssessment: {
            hasRootCardinalityClaim: false,
            hasMemberListClaim: true,
            hasAvoidRuleClaim: true,
            passesShortlistGate: false,
          },
          semanticCoverage: coverage,
          strictCoverage: coverage,
          goldCoverage: coverage,
          diagnostics: { promptPackId: "enumeration-framework-v2" } as any,
        },
        {
          candidateId: "harness/raw/hierarchy-first/small-request",
          sourceKind: "harness",
          claimCount: 7,
          rankWithinVideo: 2,
          chunkMode: "small-request",
          promptConfigId: "hierarchy-first",
          structuralTargetScore: 0.45,
          structuralTargetAssessment: {
            hasRootCardinalityClaim: true,
            hasMemberListClaim: false,
            hasAvoidRuleClaim: false,
            passesShortlistGate: true,
          },
          semanticCoverage: coverage,
          strictCoverage: coverage,
          goldCoverage: coverage,
          diagnostics: { promptPackId: "enumeration-framework-v2" } as any,
        },
      ],
    }, 1, false);

    expect(selected.map((candidate) => candidate.candidateId)).toEqual([
      "harness/raw/hierarchy-first/small-request",
    ]);
  });

  it("does not let a gated finite-set candidate override a much stronger semantic candidate", () => {
    const weakCoverage = {
      matched: 1,
      total: 5,
      ratio: 0.2,
      rootsMatched: 0,
      rootsTotal: 1,
      rootRatio: 0,
      childrenMatched: 1,
      childrenTotal: 4,
      childRatio: 0.25,
      unmatchedGoldClaims: [],
      unmatchedCandidateClaims: [],
      matchedPairs: [],
      nearestMisses: [],
    };
    const strongCoverage = {
      ...weakCoverage,
      matched: 2,
      ratio: 0.4,
      childrenMatched: 2,
      childRatio: 0.5,
    };

    const selected = selectShortlistCandidatesForVideo({
      videoId: "RfEOrbbMwMU",
      title: "Consulting slides",
      candidateReports: [
        {
          candidateId: "harness/raw/baseline/large-request",
          sourceKind: "harness",
          claimCount: 6,
          rankWithinVideo: 2,
          chunkMode: "large-request",
          promptConfigId: "baseline",
          structuralTargetScore: 1,
          structuralTargetAssessment: {
            hasRootCardinalityClaim: true,
            hasMemberListClaim: true,
            hasAvoidRuleClaim: true,
            passesShortlistGate: true,
          },
          semanticCoverage: weakCoverage,
          strictCoverage: weakCoverage,
          goldCoverage: weakCoverage,
          diagnostics: { promptPackId: "enumeration-framework-v2" } as any,
        },
        {
          candidateId: "harness/raw/baseline/small-request",
          sourceKind: "harness",
          claimCount: 9,
          rankWithinVideo: 1,
          chunkMode: "small-request",
          promptConfigId: "baseline",
          structuralTargetScore: 0.45,
          structuralTargetAssessment: {
            hasRootCardinalityClaim: false,
            hasMemberListClaim: true,
            hasAvoidRuleClaim: false,
            passesShortlistGate: false,
          },
          semanticCoverage: strongCoverage,
          strictCoverage: strongCoverage,
          goldCoverage: strongCoverage,
          diagnostics: { promptPackId: "enumeration-framework-v2" } as any,
        },
      ],
    }, 1, false);

    expect(selected.map((candidate) => candidate.candidateId)).toEqual([
      "harness/raw/baseline/small-request",
    ]);
  });

  it("can complete a fresh narrow manual baseline run without a shortlist TDZ crash", async () => {
    const transcriptDir = await mkdtemp(join(tmpdir(), "aidha-transcripts-"));
    const manualBaselineDir = await mkdtemp(join(tmpdir(), "aidha-manual-"));
    const outputDir = await mkdtemp(join(tmpdir(), "aidha-output-"));

    await writeFile(
      join(transcriptDir, "video-1.json"),
      JSON.stringify({
        videoId: "video-1",
        fullText: "There are five slide layouts. Avoid pie charts when comparing shares.",
        segments: [
          { start: 0, duration: 1, text: "There are five slide layouts." },
        ],
      })
    );
    await writeFile(
      join(manualBaselineDir, "video-1-gold-draft-v1.json"),
      JSON.stringify({
        videoId: "video-1",
        title: "Video 1",
        idealClaims: [
          {
            text: "There are five slide layouts.",
            type: "fact",
            children: [],
          },
        ],
        rejectedClaims: [],
      })
    );

    const report = await runNarrowManualBaselineComparison({
      corpus: [
        {
          videoId: "video-1",
          url: "https://youtube.com/watch?v=video-1",
          title: "Video 1",
          channelName: "Channel 1",
          durationMinutes: 1,
          topicDomain: "Business strategy",
          expectedClaimDensity: "low",
          rationale: "test",
        },
      ] as any,
      transcriptDir,
      manualBaselineDir,
      outputDir,
      models: [{ id: "model-1" }] as any,
      variants: ["raw"] as any,
      judgeModelIds: [],
      fallbackModelId: "model-1",
      config: {
        llm: {
          model: "gpt-4o-mini",
          apiKey: "test-key", // pragma: allowlist secret
          baseUrl: "",
          timeoutMs: 1000,
          cacheDir: "test-cache",
        },
      } as any,
      clientFactory: () => ({}) as any,
      runMode: "fast-triage",
    });

  expect(report.metadata.completedStages).toEqual(
      expect.arrayContaining(["shortlist", "score", "report"])
    );
    expect(report.videos).toHaveLength(1);
    expect(report.videos[0]?.candidateReports.length).toBeGreaterThan(0);
  });

  it("resumes refine artifacts and still judges refined rows after a score recompute", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "narrow-manual-baseline-resume-"));
    const transcriptDir = await mkdtemp(join(rootDir, "transcripts-"));
    const manualBaselineDir = await mkdtemp(join(rootDir, "manual-"));
    const outputDir = await mkdtemp(join(rootDir, "output-"));

    await writeFile(
      join(transcriptDir, "video-1.json"),
      JSON.stringify({
        videoId: "video-1",
        fullText: "There are five slide layouts. Avoid pie charts when comparing shares.",
        segments: [
          { start: 0, duration: 1, text: "There are five slide layouts." },
          { start: 1, duration: 1, text: "Avoid pie charts when comparing shares." },
        ],
      })
    );
    await writeFile(
      join(manualBaselineDir, "video-1-gold-draft-v1.json"),
      JSON.stringify({
        videoId: "video-1",
        title: "Video 1",
        idealClaims: [
          {
            text: "There are five slide layouts.",
            type: "fact",
            children: [],
          },
          {
            text: "Avoid pie charts when comparing shares.",
            type: "recommendation",
            children: [],
          },
        ],
        rejectedClaims: [],
      })
    );

    const judgeClient = {
      generate: vi.fn().mockResolvedValue({
        ok: true,
        value: JSON.stringify({
          summary: "good",
          matchedGoldClaims: [],
          missedGoldClaims: [],
          unsupportedCandidateClaims: [],
          redundantCandidateClaims: [],
          structuralIssues: [],
        }),
      }),
    };

    const runOptions = {
      corpus: [
        {
          videoId: "video-1",
          url: "https://youtube.com/watch?v=video-1",
          title: "Video 1",
          channelName: "Channel 1",
          durationMinutes: 1,
          topicDomain: "Business strategy",
          expectedClaimDensity: "low",
          rationale: "test",
        },
      ] as any,
      transcriptDir,
      manualBaselineDir,
      outputDir,
      models: [{ id: "model-1" }] as any,
      variants: ["raw", "self-improve-v1"] as any,
      judgeModelIds: ["judge-1"],
      judgeMaxTokens: 4000,
      includeManualBaselines: false,
      fallbackModelId: "model-1",
      config: {
        llm: {
          model: "gpt-4o-mini",
          apiKey: "test-key", // pragma: allowlist secret
          baseUrl: "",
          timeoutMs: 1000,
          cacheDir: "test-cache",
        },
      } as any,
      clientFactory: () => judgeClient as any,
      runMode: "fast-triage" as const,
      shortlistPerVideo: 10,
    };

    const firstRun = await runNarrowManualBaselineComparison({
      ...runOptions,
      judgeEnabled: false,
    });
    const secondRun = await runNarrowManualBaselineComparison({
      ...runOptions,
      runMode: "compare" as const,
      judgeEnabled: true,
    });

    expect(firstRun.metadata.stageExecution.refine).toBe("recomputed");
    expect(secondRun.metadata.stageExecution.refine).toBe("resumed");
    expect(secondRun.metadata.stageExecution.score).toBe("recomputed");

    const candidateReports = secondRun.videos[0]?.candidateReports ?? [];
    const selfImproveIds = candidateReports
      .filter((candidate) => candidate.variantId === "self-improve-v1")
      .map((candidate) => candidate.candidateId);

    expect(selfImproveIds.some((candidateId) => candidateId.endsWith("/refine"))).toBe(true);
    expect(new Set(selfImproveIds).size).toBe(selfImproveIds.length);

    const refinedCandidate = candidateReports.find((candidate) => candidate.candidateId.endsWith("/refine"));
    expect(refinedCandidate?.judgeFindingsByModel).toBeDefined();
  });

  it("rejects path-traversal videoId values in narrow corpus entries", () => {
    const entry = {
      videoId: "../outside",
      url: "https://www.youtube.com/watch?v=abc123",
      title: "Malicious entry",
      channelName: "Test",
      durationMinutes: 10,
      topicDomain: "Test",
      expectedClaimDensity: "medium" as const,
      rationale: "test",
    };
    expect(NarrowCorpusSchema.safeParse([entry]).success).toBe(true);
    expect(validateSafeId(entry.videoId)).toBeNull();
  });

  it("rejects videoId values with slashes in narrow corpus entries", () => {
    const entry = {
      videoId: "a/b",
      url: "https://www.youtube.com/watch?v=abc123",
      title: "Malicious entry",
      channelName: "Test",
      durationMinutes: 10,
      topicDomain: "Test",
      expectedClaimDensity: "medium" as const,
      rationale: "test",
    };
    expect(NarrowCorpusSchema.safeParse([entry]).success).toBe(true);
    expect(validateSafeId(entry.videoId)).toBeNull();
  });

  it("accepts valid YouTube-style videoId values in narrow corpus entries", () => {
    const entry = {
      videoId: "RfEOrbbMwMU",
      url: "https://www.youtube.com/watch?v=RfEOrbbMwMU",
      title: "Valid entry",
      channelName: "Test",
      durationMinutes: 10,
      topicDomain: "Test",
      expectedClaimDensity: "medium" as const,
      rationale: "test",
    };
    expect(NarrowCorpusSchema.safeParse([entry]).success).toBe(true);
    expect(validateSafeId(entry.videoId)).toBe("RfEOrbbMwMU");
  });

  it("respects zero embedding budget in computeCoverageByMode", async () => {
    const budgetState: EmbeddingBudgetState = { remainingEmbeddingRequests: 0 };
    const result = await computeCoverageByMode(
      [
        { text: "Candidate claim A", excerptIds: ["e1"] },
        { text: "Candidate claim B", excerptIds: ["e2"] },
      ],
      [
        { id: "v:1", depth: 0, path: [1], text: "Gold claim A", type: "fact", evidence: undefined },
        { id: "v:2", depth: 0, path: [2], text: "Gold claim B", type: "fact", evidence: undefined },
      ],
      "embedding",
      undefined,
      undefined,
      budgetState
    );
    expect(result.matched).toBe(0);
    expect(result.total).toBe(2);
    expect(budgetState.remainingEmbeddingRequests).toBe(0);
  });

  it("does not decrement embedding budget when embedding client is unavailable in computeCoverageByMode", async () => {
    const budgetState: EmbeddingBudgetState = { remainingEmbeddingRequests: 2 };
    const result = await computeCoverageByMode(
      [
        { text: "Candidate claim", excerptIds: ["e1"] },
      ],
      [
        { id: "v:1", depth: 0, path: [1], text: "Completely different gold", type: "fact", evidence: undefined },
      ],
      "embedding",
      undefined,
      undefined,
      budgetState
    );
    expect(result.total).toBe(1);
    expect(budgetState.remainingEmbeddingRequests).toBe(2);
  });
});
