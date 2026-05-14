import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXCERPTS_DIR = join(__dirname, "../fixtures/eval-matrix/transcript-excerpts");

const TranscriptSegmentSchema = z.object({
  start: z.number().nonnegative(),
  duration: z.number().positive(),
  text: z.string().min(1),
});

const TranscriptExcerptSchema = z.object({
  videoId: z.string().min(1),
  language: z.string().length(2),
  segments: z.array(TranscriptSegmentSchema).min(1),
  fullText: z.string().min(1),
});

describe("transcript excerpt fixtures", () => {
  const files = readdirSync(EXCERPTS_DIR).filter(f => f.endsWith(".json"));

  it("has at least 3 excerpt files covering multiple topic domains", () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  for (const file of files) {
    it(`${file} conforms to TranscriptExcerptSchema`, () => {
      const raw = JSON.parse(readFileSync(join(EXCERPTS_DIR, file), "utf-8"));
      const result = TranscriptExcerptSchema.safeParse(raw);
      if (!result.success) {
        throw new Error(`${file}: ${JSON.stringify(result.error.format(), null, 2)}`);
      }
    });

    it(`${file} fullText matches concatenated segment text`, () => {
      const raw = JSON.parse(readFileSync(join(EXCERPTS_DIR, file), "utf-8"));
      const joined = raw.segments.map((s: { text: string }) => s.text).join(" ");
      expect(raw.fullText).toBe(joined);
    });
  }
});
