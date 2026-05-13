import type { CorpusEntry } from "./corpus-schema.js";
import { hashId } from "../utils/ids.js";

interface CorpusSignatureEntry {
  videoId: string;
  url: string;
  title: string;
  channelName: string;
  durationMinutes: number;
  topicDomain: string;
  expectedClaimDensity: string;
  description: string;
  language: string;
  captionSource: string;
  speakerStyle: string;
  rationale: string;
}

export function buildCorpusSignature(corpus: CorpusEntry[]): string {
  const normalizedCorpus: CorpusSignatureEntry[] = corpus
    .slice()
    .sort((a, b) => a.videoId.localeCompare(b.videoId))
    .map((entry) => ({
      videoId: entry.videoId,
      url: entry.url,
      title: entry.title,
      channelName: entry.channelName,
      durationMinutes: entry.durationMinutes,
      topicDomain: entry.topicDomain,
      expectedClaimDensity: entry.expectedClaimDensity,
      description: entry.description ?? "",
      language: entry.language ?? "",
      captionSource: entry.captionSource ?? "",
      speakerStyle: entry.speakerStyle ?? "",
      rationale: entry.rationale,
    }));

  return hashId("narrow-corpus", [JSON.stringify(normalizedCorpus)]);
}
