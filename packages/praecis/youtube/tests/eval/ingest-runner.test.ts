import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSingleVideoIngestArgs,
  selectPendingVideoIds,
  transcriptPath,
} from "../../../../../scripts/eval-matrix/ingest-runner-lib.mjs";

describe("eval ingest runner helpers", () => {
  const corpus = [
    { videoId: "video-a" },
    { videoId: "video-b" },
    { videoId: "video-c" },
  ];

  it("selects only uncached videos in corpus order", () => {
    const pending = selectPendingVideoIds(corpus, new Set(["video-b"]));
    expect(pending).toEqual(["video-a", "video-c"]);
  });

  it("supports targeting one uncached video", () => {
    const pending = selectPendingVideoIds(corpus, new Set(["video-a"]), "video-c");
    expect(pending).toEqual(["video-c"]);
  });

  it("returns no work when a targeted video is already cached", () => {
    const pending = selectPendingVideoIds(corpus, new Set(["video-b"]), "video-b");
    expect(pending).toEqual([]);
  });

  it("builds a single-video ingest invocation with batch delays disabled", () => {
    const configPath = path.join(".aidha", "config.yaml");
    const args = buildSingleVideoIngestArgs({
      corpusPath: "out/eval-matrix/corpus.generated.json",
      cacheDir: "out/eval-matrix/transcripts",
      dbPath: "out/eval-matrix/aidha-eval.sqlite",
      configPath,
    }, "video-c");

    expect(args).toEqual([
      "scripts/eval-matrix/ingest-corpus.sh",
      "--corpus", "out/eval-matrix/corpus.generated.json",
      "--cache-dir", "out/eval-matrix/transcripts",
      "--db", "out/eval-matrix/aidha-eval.sqlite",
      "--config", configPath,
      "--video-id", "video-c",
      "--request-delay-seconds", "0",
      "--failure-delay-seconds", "0",
    ]);
  });

  it("derives transcript cache paths predictably", () => {
    expect(transcriptPath("out/eval-matrix/transcripts", "video-c")).toBe(
      "out/eval-matrix/transcripts/video-c.json",
    );
  });
});
