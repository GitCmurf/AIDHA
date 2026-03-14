import { describe, expect, it } from "vitest";
import {
  cleanSegmentText,
  normalizeTranscriptDocument,
  validateNormalizedTranscript,
} from "../../../../../scripts/eval-matrix/transcript-normalize-lib.mjs";

describe("transcript normalization helpers", () => {
  it("cleans embedded cue markup and entities from segment text", () => {
    expect(
      cleanSegmentText("piece and<00:11:18.760><c> see</c><00:11:18.920> &nbsp;more"),
    ).toBe("piece and see more");
  });

  it("normalizes transcript export shape into eval transcript shape", () => {
    const normalized = normalizeTranscriptDocument({
      videoId: "abc123",
      title: "Example",
      url: "https://www.youtube.com/watch?v=abc123",
      segments: [
        { id: "1", start: 0, end: 1.5, duration: 1.5, text: "Hello&nbsp;world" },
        { id: "2", start: 1.5, end: 2.5, duration: 1.0, text: "<00:00:01.500><c>again</c>" },
      ],
    });

    expect(normalized).toEqual({
      videoId: "abc123",
      language: "en",
      segments: [
        { start: 0, duration: 1.5, text: "Hello world" },
        { start: 1.5, duration: 1, text: "again" },
      ],
      fullText: "Hello world again",
    });
    expect(validateNormalizedTranscript(normalized)).toBe(true);
  });
});
