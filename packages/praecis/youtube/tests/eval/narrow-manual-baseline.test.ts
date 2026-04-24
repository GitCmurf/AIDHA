import { describe, expect, it } from "vitest";
import {
  assessStructuralTargets,
  buildExtractionStageInputSignature,
  computeOptimizationScore,
  computeGoldCoverage,
  needsFallbackForModel,
  profileTranscriptStructure,
  renderNarrowComparisonMarkdown,
  selectShortlistCandidatesForVideo,
  selectFastTriageEscalationPack,
  shouldFastTriageEscalate,
} from "../../src/eval/narrow-manual-baseline";

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
        { videoId: "RfEOrbbMwMU", url: "https://youtube.com/watch?v=RfEOrbbMwMU", title: "Video 1", channelName: "Channel 1", durationMinutes: 10 },
        { videoId: "xZzkNJ0e5J0", url: "https://youtube.com/watch?v=xZzkNJ0e5J0", title: "Video 2", channelName: "Channel 2", durationMinutes: 20 },
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
    };

    expect(await buildExtractionStageInputSignature(common as any)).toBe(
      await buildExtractionStageInputSignature({
        ...common,
      } as any)
    );
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
});
