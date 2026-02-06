import type { GraphNode, GraphStore } from '@aidha/graph-backend';
import type { Result } from '../pipeline/types.js';
import type { DossierClaim, VideoDossier, PlaylistDossier, PlaylistDossierInput } from './types.js';

export interface DossierExporterConfig {
  graphStore: GraphStore;
}

function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function buildTimestampUrl(baseUrl: string, seconds: number): string {
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}t=${Math.max(0, Math.floor(seconds))}s`;
}

function normalizeText(text: string | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function toNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isNaN(parsed) ? fallback : parsed;
  }
  return fallback;
}

function sortClaims(claims: DossierClaim[]): DossierClaim[] {
  return claims.slice().sort((a, b) => {
    if (a.timestampSeconds !== b.timestampSeconds) return a.timestampSeconds - b.timestampSeconds;
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
      lines.push(`${index + 1}. [${claim.timestampLabel}](${claim.timestampUrl}) ${claim.text}`);
      lines.push(`   - Excerpt: ${claim.excerptText}`);
      if (claim.type || typeof claim.confidence === 'number' || claim.method) {
        const metaBits = [
          claim.type ? `type=${claim.type}` : null,
          typeof claim.confidence === 'number' ? `confidence=${claim.confidence.toFixed(2)}` : null,
          claim.method ? `method=${claim.method}` : null,
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
        lines.push(`${index + 1}. [${claim.timestampLabel}](${claim.timestampUrl}) ${claim.text}`);
        lines.push(`   - Excerpt: ${claim.excerptText}`);
        if (claim.type || typeof claim.confidence === 'number' || claim.method) {
          const metaBits = [
            claim.type ? `type=${claim.type}` : null,
            typeof claim.confidence === 'number' ? `confidence=${claim.confidence.toFixed(2)}` : null,
            claim.method ? `method=${claim.method}` : null,
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

  async buildVideoDossier(videoId: string): Promise<Result<VideoDossier>> {
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

    const claims: DossierClaim[] = [];
    for (const claim of claimsResult.value.items) {
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
      const excerptText = excerpt ? normalizeText(excerpt.content) : '';

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
        timestampSeconds,
        timestampLabel: formatTimestamp(timestampSeconds),
        timestampUrl: buildTimestampUrl(baseUrl, timestampSeconds),
        excerptText: truncateText(excerptText, 220),
        excerptId: excerpt?.id,
        referenceUrls,
        type: typeof claim.metadata?.['type'] === 'string' ? (claim.metadata?.['type'] as string) : undefined,
        confidence: typeof claim.metadata?.['confidence'] === 'number'
          ? (claim.metadata?.['confidence'] as number)
          : undefined,
        method: typeof claim.metadata?.['method'] === 'string' ? (claim.metadata?.['method'] as string) : undefined,
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

  async renderVideoDossier(videoId: string): Promise<Result<string>> {
    const dossierResult = await this.buildVideoDossier(videoId);
    if (!dossierResult.ok) return dossierResult;
    return { ok: true, value: renderVideoMarkdown(dossierResult.value) };
  }

  async buildPlaylistDossier(input: PlaylistDossierInput): Promise<Result<PlaylistDossier>> {
    const videos: VideoDossier[] = [];
    for (const videoId of input.videoIds) {
      const result = await this.buildVideoDossier(videoId);
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

  async renderPlaylistDossier(input: PlaylistDossierInput): Promise<Result<string>> {
    const dossierResult = await this.buildPlaylistDossier(input);
    if (!dossierResult.ok) return dossierResult;
    return { ok: true, value: renderPlaylistMarkdown(dossierResult.value) };
  }
}
