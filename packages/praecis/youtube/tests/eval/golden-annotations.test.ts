import { describe, it, expect } from "vitest";
import { GoldenAnnotationSchema } from "../../src/eval/golden-annotation-schema";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Golden Annotations Validation", () => {
  it("should validate the checked-in golden-annotations.json", () => {
    const fixturePath = path.join(__dirname, "../fixtures/eval-matrix/golden-annotations.json");
    if (!fs.existsSync(fixturePath)) {
      throw new Error(`Golden annotations fixture not found at ${fixturePath}`);
    }

    const data = JSON.parse(fs.readFileSync(fixturePath, "utf-8"));
    const result = GoldenAnnotationSchema.safeParse(data);

    if (!result.success) {
      console.error(JSON.stringify(result.error.format(), null, 2));
    }

    expect(result.success).toBe(true);
  });

  it("should reject invalid idealClaims (endMs < startMs)", () => {
    const invalidData = [
      {
        videoId: "v1",
        idealClaims: [
          {
            text: "invalid range",
            evidence: { startMs: 100, endMs: 50 }
          }
        ],
        rejectedClaims: []
      }
    ];
    const result = GoldenAnnotationSchema.safeParse(invalidData);
    expect(result.success).toBe(false);
  });

  it("should reject invalid rejection reasons", () => {
    const invalidData = [
      {
        videoId: "v1",
        idealClaims: [],
        rejectedClaims: [
          {
            text: "bad reason",
            reason: "not-a-reason"
          }
        ]
      }
    ];
    const result = GoldenAnnotationSchema.safeParse(invalidData);
    expect(result.success).toBe(false);
  });
});
