import type { GraphNode, GraphStore } from '@aidha/graph-backend';
import type { Result } from '../pipeline/types.js';
import type {
  DossierClaim,
  VideoDossier,
  PlaylistDossier,
  PlaylistDossierInput,
  TranscriptExport,
  PlaylistTranscriptExport,
  TranscriptSegmentExport,
} from './types.js';
import type { ClaimState } from '../utils/claim-state.js';
import { DEFAULT_CLAIM_STATE, normalizeClaimState } from '../utils/claim-state.js';
import { getStringMetadata, getNumberMetadata, formatTimestamp, buildTimestampUrl, normalizeText, truncateText, toNumber } from '../extract/utils.js';

export interface DossierExporterConfig {
  graphStore: GraphStore;
}

export interface DossierBuildOptions {
  states?: ClaimState[];
}

export interface JsonExportOptions {
  pretty?: boolean;
}

function sortClaims(claims: DossierClaim[]): DossierClaim[] {
  return claims.slice().sort((a, b) => {
    if (a.timestampSeconds !== b.timestampSeconds) return a.timestampSeconds - b.timestampSeconds;
    return a.id.localeCompare(b.id);
  });
}

function sortTranscriptSegments(segments: TranscriptSegmentExport[]): TranscriptSegmentExport[] {
  return segments.slice().sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return a.id.localeCompare(b.id);
  });
}

function sortReferences(refs: string[]): string[] {
  return Array.from(new Set(refs)).sort((a, b) => a.localeCompare(b));
}

function renderVideoMarkdown(dossier: VideoDossier): string {
  const lines: string[] = [];
  lines.push(`# Dossier: ${dossier.title}`);
  lines.push('');
  if (dossier.channelName) {
    lines.push(`- Channel: ${dossier.channelName}`);
  }
  lines.push(`- Video: ${dossier.url}`);
  lines.push('');
  lines.push('## Claims');
  if (dossier.claims.length === 0) {
    lines.push('');
    lines.push('_No claims extracted._');
  } else {
    lines.push('');
    for (const [index, claim] of dossier.claims.entries()) {
      const statePrefix = claim.state === 'accepted' ? '' : `[${claim.state}] `;
      lines.push(`${index + 1}. [${claim.timestampLabel}](${claim.timestampUrl}) ${statePrefix}${claim.text}`);
      lines.push(`   - Excerpt: ${claim.excerptText}`);
      if (claim.domain || claim.classification) {
        const resolutionBits = [
          claim.domain ? `**Domain:** ${claim.domain}` : null,
          claim.classification ? `**Classification:** ${claim.classification}` : null,
        ].filter(Boolean);
        lines.push(`   - ${resolutionBits.join(' | ')}`);
      }
      if (claim.evidenceType) {
        lines.push(`   - **Evidence:** ${claim.evidenceType}`);
      }
      if (claim.type || typeof claim.confidence === 'number' || claim.method || typeof claim.echoOverlapRatio === 'number') {
        const metaBits = [
          claim.type ? `type=${claim.type}` : null,
          typeof claim.confidence === 'number' ? `confidence=${claim.confidence.toFixed(2)}` : null,
          claim.method ? `method=${claim.method}` : null,
          typeof claim.echoOverlapRatio === 'number' ? `echo=${(claim.echoOverlapRatio * 100).toFixed(0)}%` : null,
        ].filter(Boolean);
        if (metaBits.length > 0) {
          lines.push(`   - Meta: ${metaBits.join(', ')}`);
        }
      }
      if (claim.referenceUrls.length > 0) {
        lines.push(`   - References: ${claim.referenceUrls.join(', ')}`);
      }
    }
  }
  lines.push('');
  lines.push('## References');
  if (dossier.references.length === 0) {
    lines.push('');
    lines.push('_No references extracted._');
  } else {
    lines.push('');
    for (const ref of dossier.references) {
      lines.push(`- ${ref}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

function renderPlaylistMarkdown(dossier: PlaylistDossier): string {
  const lines: string[] = [];
  const title = dossier.title ? `: ${dossier.title}` : '';
  lines.push(`# Playlist Dossier${title}`);
  lines.push('');
  if (dossier.url) {
    lines.push(`- Playlist: ${dossier.url}`);
  }
  lines.push(`- Videos: ${dossier.videos.length}`);
  lines.push('');
  lines.push('## Index');
  lines.push('');
  dossier.videos.forEach((video, index) => {
    const slug =
      video.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') ||
      `video-${index + 1}`;
    lines.push(`${index + 1}. [${video.title}](#${slug})`);
  });
  lines.push('');
  for (const video of dossier.videos) {
    lines.push(`## ${video.title}`);
    lines.push('');
    lines.push(`- Video: ${video.url}`);
    if (video.channelName) {
      lines.push(`- Channel: ${video.channelName}`);
    }
    lines.push('');
    lines.push('### Claims');
    if (video.claims.length === 0) {
      lines.push('');
      lines.push('_No claims extracted._');
    } else {
      lines.push('');
      for (const [index, claim] of video.claims.entries()) {
        const statePrefix = claim.state === 'accepted' ? '' : `[${claim.state}] `;
        lines.push(`${index + 1}. [${claim.timestampLabel}](${claim.timestampUrl}) ${statePrefix}${claim.text}`);
        lines.push(`   - Excerpt: ${claim.excerptText}`);
        if (claim.domain || claim.classification) {
          const resolutionBits = [
            claim.domain ? `**Domain:** ${claim.domain}` : null,
            claim.classification ? `**Classification:** ${claim.classification}` : null,
          ].filter(Boolean);
          lines.push(`   - ${resolutionBits.join(' | ')}`);
        }
        if (claim.evidenceType) {
          lines.push(`   - **Evidence:** ${claim.evidenceType}`);
        }
        if (claim.type || typeof claim.confidence === 'number' || claim.method || typeof claim.echoOverlapRatio === 'number') {
          const metaBits = [
            claim.type ? `type=${claim.type}` : null,
            typeof claim.confidence === 'number' ? `confidence=${claim.confidence.toFixed(2)}` : null,
            claim.method ? `method=${claim.method}` : null,
            typeof claim.echoOverlapRatio === 'number' ? `echo=${(claim.echoOverlapRatio * 100).toFixed(0)}%` : null,
          ].filter(Boolean);
          if (metaBits.length > 0) {
            lines.push(`   - Meta: ${metaBits.join(', ')}`);
          }
        }
        if (claim.referenceUrls.length > 0) {
          lines.push(`   - References: ${claim.referenceUrls.join(', ')}`);
        }
      }
    }
    lines.push('');
    lines.push('### References');
    if (video.references.length === 0) {
      lines.push('');
      lines.push('_No references extracted._');
    } else {
      lines.push('');
      for (const ref of video.references) {
        lines.push(`- ${ref}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

export class DossierExporter {
  private graphStore: GraphStore;

  constructor(config: DossierExporterConfig) {
    this.graphStore = config.graphStore;
  }

  async buildVideoDossier(videoId: string, options: DossierBuildOptions = {}): Promise<Result<VideoDossier>> {
    const resourceId = `youtube-${videoId}`;
    const resourceResult = await this.graphStore.getNode(resourceId);
    if (!resourceResult.ok) return resourceResult;
    const resource = resourceResult.value;
    if (!resource) {
      return { ok: false, error: new Error(`Resource not found: ${resourceId}`) };
    }

    const excerptsResult = await this.graphStore.queryNodes({
      type: 'Excerpt',
      filters: { resourceId },
    });
    if (!excerptsResult.ok) return excerptsResult;
    const excerpts = excerptsResult.value.items;
    const excerptMap = new Map(excerpts.map(excerpt => [excerpt.id, excerpt]));

    const claimsResult = await this.graphStore.queryNodes({
      type: 'Claim',
      filters: { resourceId },
    });
    if (!claimsResult.ok) return claimsResult;

    const referencesResult = await this.graphStore.queryNodes({
      type: 'Reference',
      filters: { resourceId },
    });
    if (!referencesResult.ok) return referencesResult;
    const referenceMap = new Map<string, string>();
    for (const reference of referencesResult.value.items) {
      const url = reference.metadata?.['url'];
      if (typeof url === 'string' && url.length > 0) {
        referenceMap.set(reference.id, url);
      }
    }

    const baseUrl =
      (resource.metadata?.['url'] as string | undefined) ||
      `https://www.youtube.com/watch?v=${videoId}`;

    const allowedStates = new Set<ClaimState>(options.states ?? [DEFAULT_CLAIM_STATE]);
    const claims: DossierClaim[] = [];
    for (const claim of claimsResult.value.items) {
      const state = normalizeClaimState(claim.metadata?.['state']) ?? DEFAULT_CLAIM_STATE;
      if (!allowedStates.has(state)) continue;
      const derivedEdges = await this.graphStore.getEdges({
        predicate: 'claimDerivedFrom',
        subject: claim.id,
      });
      if (!derivedEdges.ok) return derivedEdges;
      const excerptCandidates = derivedEdges.value.items
        .map(edge => excerptMap.get(edge.object))
        .filter((excerpt): excerpt is GraphNode => Boolean(excerpt));

      const excerpt = excerptCandidates.sort((a, b) => {
        const aStart = toNumber(a.metadata?.['start'], 0);
        const bStart = toNumber(b.metadata?.['start'], 0);
        if (aStart !== bStart) return aStart - bStart;
        return a.id.localeCompare(b.id);
      })[0];

      const timestampSeconds = excerpt
        ? toNumber(excerpt.metadata?.['start'], 0)
        : toNumber(claim.metadata?.['startSeconds'], 0);
      const excerptText = excerpt ? normalizeText(excerpt.content ?? '') : '';

      const referenceEdges = await this.graphStore.getEdges({
        predicate: 'claimMentionsReference',
        subject: claim.id,
      });
      if (!referenceEdges.ok) return referenceEdges;
      const referenceUrls = sortReferences(
        referenceEdges.value.items
          .map(edge => referenceMap.get(edge.object))
          .filter((url): url is string => Boolean(url))
      );

      claims.push({
        id: claim.id,
        text: normalizeText(claim.content ?? claim.label),
        state,
        timestampSeconds,
        timestampLabel: formatTimestamp(timestampSeconds),
        timestampUrl: buildTimestampUrl(baseUrl, timestampSeconds),
        excerptText: truncateText(excerptText, 220),
        excerptId: excerpt?.id,
        referenceUrls,
        type: getStringMetadata(claim.metadata, 'type'),
        classification: getStringMetadata(claim.metadata, 'classification'),
        domain: getStringMetadata(claim.metadata, 'domain'),
        evidenceType: getStringMetadata(claim.metadata, 'evidenceType'),
        confidence: getNumberMetadata(claim.metadata, 'confidence'),
        method: getStringMetadata(claim.metadata, 'method'),
        echoOverlapRatio: getNumberMetadata(claim.metadata, 'echoOverlapRatio'),
      });
    }

    const sortedClaims = sortClaims(claims);
    const references = sortReferences(sortedClaims.flatMap(claim => claim.referenceUrls));
    const dossier: VideoDossier = {
      resourceId,
      videoId,
      title: resource.label,
      channelName: resource.metadata?.['channelName'] as string | undefined,
      url: baseUrl,
      claims: sortedClaims,
      references,
    };

    return { ok: true, value: dossier };
  }

  async renderVideoDossier(videoId: string, options: DossierBuildOptions = {}): Promise<Result<string>> {
    const dossierResult = await this.buildVideoDossier(videoId, options);
    if (!dossierResult.ok) return dossierResult;
    return { ok: true, value: renderVideoMarkdown(dossierResult.value) };
  }

  async buildPlaylistDossier(
    input: PlaylistDossierInput,
    options: DossierBuildOptions = {}
  ): Promise<Result<PlaylistDossier>> {
    const videos: VideoDossier[] = [];
    for (const videoId of input.videoIds) {
      const result = await this.buildVideoDossier(videoId, options);
      if (!result.ok) return result;
      videos.push(result.value);
    }

    return {
      ok: true,
      value: {
        playlistId: input.playlistId,
        title: input.title,
        url: input.url,
        videos,
      },
    };
  }

  async renderPlaylistDossier(
    input: PlaylistDossierInput,
    options: DossierBuildOptions = {}
  ): Promise<Result<string>> {
    const dossierResult = await this.buildPlaylistDossier(input, options);
    if (!dossierResult.ok) return dossierResult;
    return { ok: true, value: renderPlaylistMarkdown(dossierResult.value) };
  }

  async buildTranscriptExport(videoId: string): Promise<Result<TranscriptExport>> {
    const resourceId = `youtube-${videoId}`;
    const resourceResult = await this.graphStore.getNode(resourceId);
    if (!resourceResult.ok) return resourceResult;
    const resource = resourceResult.value;
    if (!resource) {
      return { ok: false, error: new Error(`Resource not found: ${resourceId}`) };
    }

    const excerptsResult = await this.graphStore.queryNodes({
      type: 'Excerpt',
      filters: { resourceId },
    });
    if (!excerptsResult.ok) return excerptsResult;

    const baseUrl =
      (resource.metadata?.['url'] as string | undefined) ||
      `https://www.youtube.com/watch?v=${videoId}`;

    const segments = sortTranscriptSegments(
      excerptsResult.value.items.map(excerpt => {
        const start = toNumber(excerpt.metadata?.['start'], 0);
        const rawDuration = toNumber(excerpt.metadata?.['duration'], 0);
        const rawEnd = toNumber(excerpt.metadata?.['end'], Number.NaN);
        const end = Number.isNaN(rawEnd)
          ? start + Math.max(0, rawDuration)
          : rawEnd;
        const duration = rawDuration > 0
          ? rawDuration
          : Math.max(0, end - start);
        return {
          id: excerpt.id,
          start,
          end,
          duration: Math.max(0, duration),
          text: normalizeText(excerpt.content ?? ''),
        };
      })
    );

    return {
      ok: true,
      value: {
        videoId,
        resourceId,
        title: resource.label,
        url: baseUrl,
        segments,
      },
    };
  }

  async exportTranscriptJson(videoId: string, options: JsonExportOptions = {}): Promise<Result<string>> {
    const transcriptResult = await this.buildTranscriptExport(videoId);
    if (!transcriptResult.ok) return transcriptResult;
    const pretty = options.pretty ?? true;
    return {
      ok: true,
      value: JSON.stringify(transcriptResult.value, null, pretty ? 2 : undefined),
    };
  }

  async buildPlaylistTranscriptExport(input: PlaylistDossierInput): Promise<Result<PlaylistTranscriptExport>> {
    const videos: TranscriptExport[] = [];
    for (const videoId of input.videoIds) {
      const result = await this.buildTranscriptExport(videoId);
      if (!result.ok) return result;
      videos.push(result.value);
    }
    return {
      ok: true,
      value: {
        playlistId: input.playlistId,
        title: input.title,
        url: input.url,
        videos,
      },
    };
  }

  async exportPlaylistTranscriptJson(
    input: PlaylistDossierInput,
    options: JsonExportOptions = {}
  ): Promise<Result<string>> {
    const playlistResult = await this.buildPlaylistTranscriptExport(input);
    if (!playlistResult.ok) return playlistResult;
    const pretty = options.pretty ?? true;
    return {
      ok: true,
      value: JSON.stringify(playlistResult.value, null, pretty ? 2 : undefined),
    };
  }
}
