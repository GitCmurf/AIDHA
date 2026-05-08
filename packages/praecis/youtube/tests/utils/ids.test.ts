import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashFile } from "../../src/utils/ids.js";

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
