import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashFile, hashId } from "../../src/utils/ids.js";

describe("hashId", () => {
  it("uses a 128-bit digest suffix for deterministic IDs", () => {
    const id = hashId("claim", ["resource-1", "Claim text", "excerpt-1"]);

    expect(id).toMatch(/^claim-[0-9a-f]{32}$/);
  });

  it("generates unique IDs for representative persisted object inputs", () => {
    const ids = [
      hashId("claim", ["video-a", "Protein synthesis increases after resistance training.", "ex-1"]),
      hashId("claim", ["video-a", "Protein synthesis increases after protein feeding.", "ex-2"]),
      hashId("reference", ["https://example.com/paper-a"]),
      hashId("excerpt", ["video-a", 0, 15, "Opening claim text"]),
      hashId("task", ["project-a", "claim-a", "Review protein timing"]),
      hashId("narrow-stage", ["corpus-a", "model-a", "prompt-a"]),
      hashId("narrow-extraction-stage", ["corpus-a", "model-a", "prompt-a", "manual-baseline"]),
    ];

    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("hashFile", () => {
  it("hashes readable files with the ESM createReadStream import", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aidha-ids-"));
    const filePath = join(dir, "sample.txt");
    await writeFile(filePath, "sample content");

    await expect(hashFile(filePath)).resolves.toBe(
      createHash("sha256").update("sample content").digest("hex").slice(0, 32)
    );

    await rm(dir, { recursive: true, force: true });
  });

  it("resolves null for unreadable files", async () => {
    await expect(hashFile(join(tmpdir(), "missing-aidha-file"))).resolves.toBeNull();
  });
});
