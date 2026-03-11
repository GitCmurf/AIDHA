import { describe, expect, it } from "vitest";
import {
  buildCorpusEntry,
  sanitizeYouTubeUrl,
  deriveExpectedClaimDensity,
  deriveSpeakerStyle,
  inferTopicDomain,
} from "../../../../../scripts/eval-matrix/corpus-builder-lib.mjs";

describe("Corpus Builder", () => {
  it("sanitizes YouTube URLs down to watch?v form", () => {
    expect(
      sanitizeYouTubeUrl("https://www.youtube.com/watch?v=B-otG3jyL14&list=abc&index=28&pp=iAQBsAgC")
    ).toBe("https://www.youtube.com/watch?v=B-otG3jyL14");
  });

  it("derives claim density from duration", () => {
    expect(deriveExpectedClaimDensity(10)).toBe("low");
    expect(deriveExpectedClaimDensity(30)).toBe("medium");
    expect(deriveExpectedClaimDensity(90)).toBe("high");
  });

  it("infers topic domain and speaker style from metadata hints", () => {
    expect(
      inferTopicDomain({
        title: "The science of fat loss and metabolism",
        channelName: "Huberman Lab",
        description: "",
      })
    ).toBe("Nutrition");

    expect(
      deriveSpeakerStyle({
        title: "Neuroscience Panel Discussion",
        channelName: "Brain Science Foundation",
        description: "",
      })
    ).toBe("panel");
  });

  it("builds a schema-compatible corpus entry", () => {
    const entry = buildCorpusEntry({
      videoId: "abc123",
      sourceUrl: "https://www.youtube.com/watch?v=abc123&list=foo",
      title: "Complete Guide to Hypertrophy",
      channelName: "Muscle Academy",
      durationSeconds: 5700,
      description: "A long workout tutorial.",
      language: "en",
    });

    expect(entry.videoId).toBe("abc123");
    expect(entry.url).toBe("https://www.youtube.com/watch?v=abc123");
    expect(entry.durationMinutes).toBe(95);
    expect(entry.topicDomain).toBe("Exercise");
    expect(entry.expectedClaimDensity).toBe("high");
    expect(entry.speakerStyle).toBe("solo");
    expect(entry.rationale.length).toBeGreaterThan(0);
  });
});
