import { describe, expect, it } from "vitest";
import { buildSystemPrompt, buildUserPrompt } from "../../src/extract/prompts/pass1-claim-mining-v2";

describe("pass1-claim-mining-v2 prompt packs", () => {
  it("adds explicit root-plus-members guidance for enumeration v2", () => {
    const system = buildSystemPrompt("baseline", "enumeration-framework-v2");
    const user = buildUserPrompt({
      resourceLabel: "Consulting deck video",
      chunkIndex: 0,
      chunkCount: 1,
      chunkStart: 0,
      minClaims: 4,
      maxClaims: 8,
      promptPackId: "enumeration-framework-v2",
    }, [
      { id: "ex1", startSeconds: 0, text: "There are five slide layouts used in consulting decks." },
    ]);

    expect(system).toContain("root");
    expect(system).toContain("members");
    expect(system).toContain("purpose");
    expect(system).toContain("avoid");
    expect(user).toContain("set-level claim");
    expect(user).toContain("member labels");
    expect(user).toContain("all named members");
    expect(user).toContain("avoidance rules");
  });

  it("adds definition and management guidance for clinical v2", () => {
    const system = buildSystemPrompt("baseline", "clinical-risk-management-v2");
    const user = buildUserPrompt({
      resourceLabel: "Clinical lipidology video",
      chunkIndex: 0,
      chunkCount: 1,
      chunkStart: 0,
      minClaims: 4,
      maxClaims: 8,
      promptPackId: "clinical-risk-management-v2",
    }, [
      { id: "ex1", startSeconds: 0, text: "Lipoprotein(a) is genetically determined and raises cardiovascular risk." },
    ]);

    expect(system).toContain("definition");
    expect(system).toContain("management");
    expect(user).toContain("definition");
    expect(user).toContain("uncertainty");
  });

  it("uses a business-aware base role for business-framework prompts", () => {
    const system = buildSystemPrompt("baseline", "business-framework");

    expect(system).toContain("business and presentation claims");
    expect(system).not.toContain("health and physiological assertions");
  });
});
