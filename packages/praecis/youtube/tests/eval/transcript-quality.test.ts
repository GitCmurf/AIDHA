import { describe, expect, it } from "vitest";
import { summarizeTranscriptQuality } from "../../../../../scripts/eval-matrix/transcript-quality-lib.mjs";

describe("transcript quality sanity gate", () => {
  it("accepts a plausible transcript", () => {
    const segments = Array.from({ length: 24 }, (_, index) => ({
      start: index * 5,
      duration: 5,
      text: `segment ${index + 1} with plausible speech`,
    }));
    const summary = summarizeTranscriptQuality({
      fullText: segments.map(segment => segment.text).join(" "),
      segments,
    }, 2);

    expect(summary.acceptable).toBe(true);
    expect(summary.flags).toEqual([]);
  });

  it("flags a likely truncated long-form transcript", () => {
    const summary = summarizeTranscriptQuality({
      fullText: "short transcript",
      segments: [
        { start: 0, duration: 30, text: "short transcript" },
        { start: 30, duration: 30, text: "ending abruptly" },
      ],
    }, 120);

    expect(summary.acceptable).toBe(false);
    expect(summary.flags).toContain("coverage_too_low");
  });
});
