import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { ClaimCandidate } from "../extract/index.js";
import { GoldenAnnotationEntrySchema } from "./golden-annotation-schema.js";
import {
  flattenGoldenClaimForest,
  type FlattenedGoldenClaimNode,
} from "./golden-annotation-utils.js";
import type { CorpusEntry } from "./corpus-schema.js";
import type { VideoContext } from "./matrix-runner.js";
import {
  profileTranscriptStructure,
  type TranscriptStructureProfile,
} from "./narrow-structural-targets.js";
import { toManualComparableClaimSet } from "./narrow-comparable-claim-set.js";
import type { ComparableClaimSet } from "./narrow-report-types.js";

const ManualBaselineClaimsFileSchema = z.object({
  claims: z.array(z.object({
    text: z.string().min(1),
    type: z.string().optional(),
    confidence: z.number().optional(),
    why: z.string().optional(),
  })),
});

export interface TranscriptData {
  videoContext: VideoContext;
  fullText: string;
  structureProfile: TranscriptStructureProfile;
}

export interface LoadedVideoBaselines {
  goldFlatClaims: FlattenedGoldenClaimNode[];
  comparableClaimSets: ComparableClaimSet[];
}

async function readJsonFile<T>(path: string, schema: z.ZodSchema<T>): Promise<T> {
  const raw = await readFile(path, "utf-8");
  return schema.parse(JSON.parse(raw));
}

export async function loadTranscript(
  video: CorpusEntry,
  transcriptDir: string
): Promise<TranscriptData> {
  const transcript = await readJsonFile(
    join(transcriptDir, `${video.videoId}.json`),
    z.object({
      videoId: z.string(),
      language: z.string().optional(),
      fullText: z.string(),
      segments: z.array(z.object({
        start: z.number(),
        duration: z.number(),
        text: z.string(),
      })),
    })
  );

  if (transcript.videoId !== video.videoId) {
    throw new Error(
      `Transcript videoId mismatch: file contains "${transcript.videoId}" but expected "${video.videoId}" ` +
      `(${join(transcriptDir, `${video.videoId}.json`)})`
    );
  }

  return {
    videoContext: {
      videoId: video.videoId,
      title: video.title,
      channelName: video.channelName,
      description: video.description,
      url: video.url,
      durationMinutes: video.durationMinutes,
      topicDomain: video.topicDomain,
    },
    fullText: transcript.fullText,
    structureProfile: profileTranscriptStructure(transcript.fullText),
  };
}

export async function loadVideoBaselines(
  videoId: string,
  manualBaselineDir: string,
  options: { includeManualBaselines?: boolean } = {}
): Promise<LoadedVideoBaselines> {
  const goldEntry = await readJsonFile(
    join(manualBaselineDir, `${videoId}-gold-draft-v1.json`),
    GoldenAnnotationEntrySchema
  );

  const goldFlatClaims = flattenGoldenClaimForest(videoId, goldEntry.idealClaims);
  const comparableClaimSets: ComparableClaimSet[] = [];

  if (options.includeManualBaselines) {
    const baselineIds = ["CG", "GG"] as const;
    for (const baselineId of baselineIds) {
      const baseline = await readJsonFile(
        join(manualBaselineDir, `${videoId}-${baselineId}.json`),
        ManualBaselineClaimsFileSchema
      );
      const claims: ClaimCandidate[] = baseline.claims.map((claim, index) => ({
        text: claim.text,
        excerptIds: [`manual-${baselineId.toLowerCase()}-${index}`],
        type: claim.type?.toLowerCase(),
        confidence: claim.confidence,
        why: claim.why,
        method: "llm",
        state: "accepted",
      }));
      comparableClaimSets.push(toManualComparableClaimSet(videoId, baselineId, claims));
    }
  }

  return { goldFlatClaims, comparableClaimSets };
}
