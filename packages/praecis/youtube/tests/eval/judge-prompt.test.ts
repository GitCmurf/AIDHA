import { describe, it, expect } from "vitest";
import { buildJudgePrompt } from "../../src/eval/prompts/judge-claim-quality";
import type { ClaimCandidate } from "../../src/extract/types";

describe("Judge Prompt Template", () => {
  const mockTranscript = "This is a test transcript.";
  const mockClaims: ClaimCandidate[] = [{ text: "This is a claim", excerptIds: ["excerpt-1"] }];
  const mockContext = {
    videoId: "123",
    title: "Test Video",
    channelName: "Test Channel"
  };

  it("should contain all four dimension names in the prompt", () => {
    const { user } = buildJudgePrompt(mockTranscript, mockClaims, mockContext);
    expect(user).toContain("Completeness:");
    expect(user).toContain("Accuracy:");
    expect(user).toContain("Topic Coverage:");
    expect(user).toContain("Atomicity:");
  });

  it("should request JSON output", () => {
    const { system } = buildJudgePrompt(mockTranscript, mockClaims, mockContext);
    expect(system.toLowerCase()).toContain("json");
  });

  it("should include transcript content", () => {
    const { user } = buildJudgePrompt(mockTranscript, mockClaims, mockContext);
    expect(user).toContain(mockTranscript);
    expect(user).toContain("<TRANSCRIPT>");
    expect(user).toContain("</TRANSCRIPT>");
  });

  it("should include claim set", () => {
    const { user } = buildJudgePrompt(mockTranscript, mockClaims, mockContext);
    expect(user).toContain("This is a claim");
  });

  it("should include calibration examples", () => {
    const { user } = buildJudgePrompt(mockTranscript, mockClaims, mockContext);
    expect(user).toContain("CALIBRATION EXAMPLES:");
  });
});
