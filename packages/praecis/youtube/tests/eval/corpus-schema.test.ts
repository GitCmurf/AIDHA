import { describe, it, expect } from "vitest";
import { CorpusEntrySchema, CorpusSchema } from "../../src/eval/corpus-schema";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Corpus Schema Validation", () => {
  it("should validate a valid corpus entry", () => {
    const entry = {
      videoId: "h_1zlead9ZU",
      url: "https://www.youtube.com/watch?v=h_1zlead9ZU",
      title: "Dr. Andrew Huberman: The Science of Nutrition...",
      channelName: "Huberman Lab",
      durationMinutes: 124,
      topicDomain: "Nutrition",
      expectedClaimDensity: "high",
      language: "en",
      captionSource: "manual",
      speakerStyle: "interview",
      rationale: "High-density scientific assertions; multi-speaker debate.",
    };
    const result = CorpusEntrySchema.safeParse(entry);
    expect(result.success).toBe(true);
  });

  it("should reject an entry missing rationale", () => {
    const entry = {
      videoId: "h_1zlead9ZU",
      url: "https://www.youtube.com/watch?v=h_1zlead9ZU",
      title: "Dr. Andrew Huberman: The Science of Nutrition...",
      channelName: "Huberman Lab",
      durationMinutes: 124,
      topicDomain: "Nutrition",
      expectedClaimDensity: "high",
    };
    const result = CorpusEntrySchema.safeParse(entry);
    expect(result.success).toBe(false);
  });

  it("should validate the actual corpus.json file", () => {
    const corpusPath = path.join(__dirname, "../fixtures/eval-matrix/corpus.json");
    if (!fs.existsSync(corpusPath)) {
      throw new Error(`corpus.json not found at ${corpusPath}`);
    }
    const data = JSON.parse(fs.readFileSync(corpusPath, "utf-8"));
    const result = CorpusSchema.safeParse(data);
    if (!result.success) {
      console.error(JSON.stringify(result.error.format(), null, 2));
    }
    expect(result.success).toBe(true);
  });
});
