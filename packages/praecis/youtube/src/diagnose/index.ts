import type { GraphStore } from '@aidha/graph-backend';
import type { YouTubeClient } from '../client/types.js';
import type { Result } from '../pipeline/types.js';
import { DEFAULT_CLAIM_STATE, normalizeClaimState } from '../utils/claim-state.js';
import type { YtDlpEnvironmentDiagnosis } from '../client/yt-dlp.js';
import { diagnoseYtDlpEnvironment } from '../client/yt-dlp.js';

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isNaN(parsed) ? fallback : parsed;
  }
  return fallback;
}

export interface TranscriptDiagnosis {
  videoId: string;
  transcriptAvailable: boolean;
  transcriptLanguage?: string;
  segmentCount: number;
  coverageSeconds: number;
  firstSegmentStart?: number;
  lastSegmentEnd?: number;
  error?: string;
  ytdlp?: YtDlpEnvironmentDiagnosis['ytdlp'];
  jsRuntime?: YtDlpEnvironmentDiagnosis['jsRuntime'];
  ffmpeg?: YtDlpEnvironmentDiagnosis['ffmpeg'];
  issues: string[];
}

export interface TranscriptDiagnoseOptions {
  checkTooling?: boolean;
  toolingProbe?: () => Promise<Result<YtDlpEnvironmentDiagnosis>>;
}

export interface ExtractionDiagnosis {
  videoId: string;
  resourceId: string;
  transcriptStatus: string;
  claimCount: number;
  referenceCount: number;
  claimDerivedFromEdgeCount: number;
  claimsWithoutProvenance: number;
  byState: Record<'draft' | 'accepted' | 'rejected', number>;
  byMethod: Record<string, number>;
  lastClaimRun?: {
    at?: string;
    extractor?: string;
    candidates?: number;
    created?: number;
    updated?: number;
    noop?: number;
  };
  issues: string[];
}

export async function diagnoseTranscript(
  client: YouTubeClient,
  videoId: string,
  options: TranscriptDiagnoseOptions = {}
): Promise<Result<TranscriptDiagnosis>> {
  const issues: string[] = [];
  let tooling: YtDlpEnvironmentDiagnosis | undefined;
  if (options.checkTooling) {
    const probe = options.toolingProbe ?? diagnoseYtDlpEnvironment;
    const toolingResult = await probe();
    if (toolingResult.ok) {
      tooling = toolingResult.value;
      if (tooling.ytdlp.status === 'error') {
        issues.push(tooling.ytdlp.message ?? 'yt-dlp is not available.');
      }
      if (tooling.jsRuntime.status === 'error') {
        issues.push(tooling.jsRuntime.message ?? 'No supported JavaScript runtime found for yt-dlp.');
      }
      if (tooling.ffmpeg.status !== 'ok') {
        issues.push(tooling.ffmpeg.message ?? 'ffmpeg not found.');
      }
    }
  }

  const transcript = await client.fetchTranscript(videoId);
  if (!transcript.ok) {
    issues.push(transcript.error.message);
    return {
      ok: true,
      value: {
        videoId,
        transcriptAvailable: false,
        segmentCount: 0,
        coverageSeconds: 0,
        error: transcript.error.message,
        ytdlp: tooling?.ytdlp,
        jsRuntime: tooling?.jsRuntime,
        ffmpeg: tooling?.ffmpeg,
        issues,
      },
    };
  }

  const segments = transcript.value.segments.slice().sort((a, b) => a.start - b.start);
  const first = segments[0];
  const last = segments[segments.length - 1];
  const coverageSeconds = segments.reduce((total, segment) => total + segment.duration, 0);

  return {
    ok: true,
    value: {
      videoId,
      transcriptAvailable: true,
      transcriptLanguage: transcript.value.language,
      segmentCount: segments.length,
      coverageSeconds,
      firstSegmentStart: first?.start,
      lastSegmentEnd: last ? last.start + last.duration : undefined,
      ytdlp: tooling?.ytdlp,
      jsRuntime: tooling?.jsRuntime,
      ffmpeg: tooling?.ffmpeg,
      issues,
    },
  };
}

export async function diagnoseExtraction(
  store: GraphStore,
  videoId: string
): Promise<Result<ExtractionDiagnosis>> {
  const resourceId = `youtube-${videoId}`;
  const resource = await store.getNode(resourceId);
  if (!resource.ok) return resource;
  if (!resource.value) {
    return { ok: false, error: new Error(`Resource not found: ${resourceId}`) };
  }

  const transcriptStatus = (resource.value.metadata?.['transcriptStatus'] as string | undefined) ?? 'unknown';
  const lastClaimRun = {
    at: resource.value.metadata?.['lastClaimRunAt'] as string | undefined,
    extractor: resource.value.metadata?.['lastClaimRunExtractor'] as string | undefined,
    candidates: toNumber(resource.value.metadata?.['lastClaimRunCandidates'], 0),
    created: toNumber(resource.value.metadata?.['lastClaimRunCreated'], 0),
    updated: toNumber(resource.value.metadata?.['lastClaimRunUpdated'], 0),
    noop: toNumber(resource.value.metadata?.['lastClaimRunNoop'], 0),
  };
  const claimResult = await store.queryNodes({ type: 'Claim', filters: { resourceId } });
  if (!claimResult.ok) return claimResult;
  const referenceResult = await store.queryNodes({ type: 'Reference', filters: { resourceId } });
  if (!referenceResult.ok) return referenceResult;
  const derivedEdges = await store.getEdges({ predicate: 'claimDerivedFrom' });
  if (!derivedEdges.ok) return derivedEdges;

  const claimIds = new Set(claimResult.value.items.map(item => item.id));
  const derivedForResourceClaims = derivedEdges.value.items.filter(edge => claimIds.has(edge.subject));
  const claimsWithProvenance = new Set(derivedForResourceClaims.map(edge => edge.subject));

  const byState: Record<'draft' | 'accepted' | 'rejected', number> = {
    draft: 0,
    accepted: 0,
    rejected: 0,
  };
  const byMethod: Record<string, number> = {};
  for (const claim of claimResult.value.items) {
    const state = normalizeClaimState(claim.metadata?.['state']) ?? DEFAULT_CLAIM_STATE;
    byState[state] += 1;
    const method = typeof claim.metadata?.['method'] === 'string'
      ? (claim.metadata?.['method'] as string)
      : 'unknown';
    byMethod[method] = (byMethod[method] ?? 0) + 1;
  }

  const claimsWithoutProvenance = claimResult.value.items.length - claimsWithProvenance.size;
  const issues: string[] = [];
  if (transcriptStatus !== 'available') {
    issues.push(`Transcript status is "${transcriptStatus}" for ${resourceId}.`);
  }
  if (claimsWithoutProvenance > 0) {
    issues.push(`${claimsWithoutProvenance} claims are missing claimDerivedFrom provenance edges.`);
  }
  if (claimResult.value.items.length === 0) {
    issues.push('No claims extracted yet. Run extract claims first.');
  }

  return {
    ok: true,
    value: {
      videoId,
      resourceId,
      transcriptStatus,
      claimCount: claimResult.value.items.length,
      referenceCount: referenceResult.value.items.length,
      claimDerivedFromEdgeCount: derivedForResourceClaims.length,
      claimsWithoutProvenance,
      byState,
      byMethod,
      lastClaimRun,
      issues,
    },
  };
}

export function formatTranscriptDiagnosis(diagnosis: TranscriptDiagnosis, asJson = false): string {
  if (asJson) return JSON.stringify(diagnosis, null, 2);
  const lines = [
    `Transcript diagnosis for ${diagnosis.videoId}`,
    `Available: ${diagnosis.transcriptAvailable ? 'yes' : 'no'}`,
    `Language: ${diagnosis.transcriptLanguage ?? 'n/a'}`,
    `Segments: ${diagnosis.segmentCount}`,
    `Coverage seconds: ${toNumber(diagnosis.coverageSeconds, 0)}`,
  ];
  if (diagnosis.jsRuntime) {
    lines.push(
      `JS runtime: status=${diagnosis.jsRuntime.status} configured=${diagnosis.jsRuntime.configured} executable=${diagnosis.jsRuntime.executable}`
    );
  }
  if (diagnosis.ffmpeg) {
    lines.push(`ffmpeg: status=${diagnosis.ffmpeg.status} executable=${diagnosis.ffmpeg.executable}`);
  }
  if (typeof diagnosis.firstSegmentStart === 'number') lines.push(`First segment start: ${diagnosis.firstSegmentStart}`);
  if (typeof diagnosis.lastSegmentEnd === 'number') lines.push(`Last segment end: ${diagnosis.lastSegmentEnd}`);
  if (diagnosis.error) lines.push(`Error: ${diagnosis.error}`);
  if (diagnosis.issues.length > 0) {
    lines.push('Issues:');
    for (const issue of diagnosis.issues) {
      lines.push(`- ${issue}`);
    }
  }
  return lines.join('\n');
}

export function formatExtractionDiagnosis(diagnosis: ExtractionDiagnosis, asJson = false): string {
  if (asJson) return JSON.stringify(diagnosis, null, 2);
  const lines = [
    `Extraction diagnosis for ${diagnosis.resourceId}`,
    `Transcript status: ${diagnosis.transcriptStatus}`,
    `Claims: ${diagnosis.claimCount}`,
    `References: ${diagnosis.referenceCount}`,
    `claimDerivedFrom edges: ${diagnosis.claimDerivedFromEdgeCount}`,
    `Claims without provenance: ${diagnosis.claimsWithoutProvenance}`,
    `State counts: accepted=${diagnosis.byState.accepted}, draft=${diagnosis.byState.draft}, rejected=${diagnosis.byState.rejected}`,
  ];
  const methods = Object.entries(diagnosis.byMethod)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([method, count]) => `${method}=${count}`)
    .join(', ');
  lines.push(`Method counts: ${methods || 'none'}`);
  if (diagnosis.lastClaimRun?.at) {
    lines.push(
      `Last claim run: at=${diagnosis.lastClaimRun.at} extractor=${diagnosis.lastClaimRun.extractor ?? 'unknown'} created=${diagnosis.lastClaimRun.created ?? 0} updated=${diagnosis.lastClaimRun.updated ?? 0} noop=${diagnosis.lastClaimRun.noop ?? 0}`
    );
  }
  if (diagnosis.issues.length > 0) {
    lines.push('Issues:');
    for (const issue of diagnosis.issues) {
      lines.push(`- ${issue}`);
    }
  }
  return lines.join('\n');
}
