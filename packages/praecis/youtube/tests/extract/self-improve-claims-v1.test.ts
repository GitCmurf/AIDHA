import { describe, expect, it } from "vitest";
import { buildSelfImproveClaimsPrompt } from "../../src/extract/prompts/self-improve-claims-v1";

describe("self-improve-claims-v1 prompt packs", () => {
  it("adds enumeration v2 refinement guidance", () => {
    const prompt = buildSelfImproveClaimsPrompt({
      resourceLabel: "Consulting layouts",
      maxClaims: 8,
      currentClaimsJson: '{"claims":[]}',
      supportingExcerptsJson: '[]',
      promptPackId: "enumeration-framework-v2",
    });

    expect(prompt.user).toContain("umbrella/root claim");
    expect(prompt.user).toContain("cardinality");
    expect(prompt.user).toContain("all named members");
    expect(prompt.user).toContain("avoid or do-not-use rules");
    expect(prompt.user).toContain("PROMPT_PACK: enumeration-framework-v2");
  });

  it("adds clinical v2 refinement guidance", () => {
    const prompt = buildSelfImproveClaimsPrompt({
      resourceLabel: "Lp(a) management",
      maxClaims: 8,
      currentClaimsJson: '{"claims":[]}',
      supportingExcerptsJson: '[]',
      promptPackId: "clinical-risk-management-v2",
      retryReason: "missing-root-claim",
    });

    expect(prompt.user).toContain("definition/composition");
    expect(prompt.user).toContain("clinical scaffold");
    expect(prompt.user).toContain("PROMPT_PACK: clinical-risk-management-v2");
    expect(prompt.user).toContain("RETRY_REASON: missing-root-claim");
  });
});
