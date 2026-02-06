import type { GraphStore, NodeDataInput } from '@aidha/graph-backend';
import type { Result } from '../pipeline/types.js';
import type { ReferenceExtractionResult } from './types.js';
import { extractUrls } from '../utils/urls.js';
import { hashId } from '../utils/ids.js';

export interface ReferenceExtractionConfig {
  graphStore: GraphStore;
}

export class ReferenceExtractionPipeline {
  private graphStore: GraphStore;

  constructor(config: ReferenceExtractionConfig) {
    this.graphStore = config.graphStore;
  }

  async extractReferencesForVideo(videoId: string): Promise<Result<ReferenceExtractionResult>> {
    const resourceId = `youtube-${videoId}`;
    const resourceResult = await this.graphStore.getNode(resourceId);
    if (!resourceResult.ok) return resourceResult;
    if (!resourceResult.value) {
      return { ok: false, error: new Error(`Resource not found: ${resourceId}`) };
    }

    const excerptsResult = await this.graphStore.queryNodes({
      type: 'Excerpt',
      filters: { resourceId },
    });
    if (!excerptsResult.ok) return excerptsResult;
    const excerpts = excerptsResult.value.items;

    const description = resourceResult.value.metadata?.['description'] as string | undefined;
    const urls = new Set<string>(extractUrls(description));
    const excerptUrlMap = new Map<string, string[]>();

    for (const excerpt of excerpts) {
      const excerptUrls = extractUrls(excerpt.content);
      if (excerptUrls.length > 0) {
        excerptUrlMap.set(excerpt.id, excerptUrls);
        for (const url of excerptUrls) {
          urls.add(url);
        }
      }
    }

    let referencesCreated = 0;
    let referencesUpdated = 0;
    let referencesNoop = 0;
    let edgesCreated = 0;
    let edgesUpdated = 0;
    let edgesNoop = 0;

    const referenceIds = new Map<string, string>();
    for (const url of urls) {
      const referenceId = hashId('reference', [url]);
      const data: NodeDataInput = {
        label: url,
        content: url,
        metadata: {
          url,
          resourceId,
          videoId,
          source: 'youtube',
        },
      };
      const upsert = await this.graphStore.upsertNode('Reference', referenceId, data, { detectNoop: true });
      if (!upsert.ok) return upsert;
      if (upsert.value.created) referencesCreated++;
      else if (upsert.value.updated) referencesUpdated++;
      else if (upsert.value.noop) referencesNoop++;
      referenceIds.set(url, referenceId);
    }

    for (const [excerptId, excerptUrls] of excerptUrlMap.entries()) {
      const claimEdges = await this.graphStore.getEdges({
        predicate: 'claimDerivedFrom',
        object: excerptId,
      });
      if (!claimEdges.ok) return claimEdges;

      for (const edge of claimEdges.value.items) {
        for (const url of excerptUrls) {
          const referenceId = referenceIds.get(url);
          if (!referenceId) continue;
          const link = await this.graphStore.upsertEdge(
            edge.subject,
            'claimMentionsReference',
            referenceId,
            { metadata: { excerptId } },
            { detectNoop: true }
          );
          if (!link.ok) return link;
          if (link.value.created) edgesCreated++;
          else if (link.value.updated) edgesUpdated++;
          else if (link.value.noop) edgesNoop++;
        }
      }
    }

    return {
      ok: true,
      value: {
        resourceId,
        referencesCreated,
        referencesUpdated,
        referencesNoop,
        edgesCreated,
        edgesUpdated,
        edgesNoop,
      },
    };
  }
}
