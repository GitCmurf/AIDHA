import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Transcript } from "../../src/schema/transcript.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXCERPTS_DIR = join(__dirname, "../fixtures/eval-matrix/transcript-excerpts");

describe("transcript excerpt fixtures", () => {
  const files = readdirSync(EXCERPTS_DIR).filter(f => f.endsWith(".json"));

  it("has at least 3 excerpt files covering multiple topic domains", () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  for (const file of files) {
    it(`${file} conforms to Transcript schema and fullText matches segments`, () => {
      const raw = JSON.parse(readFileSync(join(EXCERPTS_DIR, file), "utf-8"));
      const result = Transcript.safeParse(raw);
      if (!result.success) {
        throw new Error(`${file}: ${JSON.stringify(result.error.format(), null, 2)}`);
      }
      const joined = result.data.segments.map(s => s.text).join(" ");
      expect(result.data.fullText).toBe(joined);
    });
  }
});
