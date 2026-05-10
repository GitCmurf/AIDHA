import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  readNarrowVideoScoreArtifact,
  writeNarrowVideoScoreArtifact,
  type NarrowVideoScoreArtifact,
} from "../../src/eval/stage-artifact-store.js";
import { sanitizeFilename } from "../../src/utils/ids.js";

describe("stage artifact store", () => {
  it("sanitizes score-video artifact filenames derived from videoId", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "aidha-stage-artifacts-"));
    try {
      const videoId = "../outside";
      const artifact: NarrowVideoScoreArtifact = {
        stage: "score-video" as const,
        mode: "test" as const,
        createdAt: "2026-05-10T00:00:00.000Z",
        videoId,
        inputSignature: "sig-1",
        video: {
          videoId,
          title: "Malicious entry",
          overallScore: 42,
        } as NarrowVideoScoreArtifact["video"],
      };

      await writeNarrowVideoScoreArtifact(outputDir, artifact);

      const expectedPath = join(outputDir, "stages", `score-video-${sanitizeFilename(videoId)}.json`);
      const persisted = JSON.parse(await readFile(expectedPath, "utf-8"));

      expect(persisted.videoId).toBe(videoId);
      expect(await readNarrowVideoScoreArtifact(outputDir, videoId)).toEqual(artifact);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});
