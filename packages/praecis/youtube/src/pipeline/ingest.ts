/**
 * Ingestion pipeline - orchestrates YouTube ingestion.
 */
import type { GraphStore, NodeDataInput, NodeType, GraphNode } from '@aidha/graph-backend';
import type { TaxonomyRegistry } from '@aidha/taxonomy';
import type { YouTubeClient } from '../client/types.js';
import type { PipelineConfig, IngestionResult, Result } from './types.js';
import type { IngestionJob, JobError, Transcript } from '../schema/index.js';
import { hashId } from '../utils/ids.js';

/**
 * Generate unique ID.
 */
function generateId(): string {
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Get current ISO timestamp.
 */
function now(): string {
  return new Date().toISOString();
}

/**
 * Ingestion pipeline for YouTube playlists.
 */
export class IngestionPipeline {
  private graphStore: GraphStore;
  private taxonomyRegistry: TaxonomyRegistry;
  private youtubeClient: YouTubeClient;

  /** Track processed video IDs for idempotency */
  private processedVideos = new Set<string>();

  constructor(config: PipelineConfig) {
    this.graphStore = config.graphStore;
    this.taxonomyRegistry = config.taxonomyRegistry;
    this.youtubeClient = config.youtubeClient;
  }

  /**
   * Ingest a YouTube playlist.
   */
  async ingestPlaylist(playlistId: string): Promise<Result<IngestionResult>> {
    // Fetch playlist
    const playlistResult = await this.youtubeClient.fetchPlaylist(playlistId);
    if (!playlistResult.ok) {
      return { ok: false, error: playlistResult.error };
    }

    const playlist = playlistResult.value;
    const errors: JobError[] = [];
    const nodeIds: string[] = [];
    let tagsAssigned = 0;
    const totalVideos = playlist.videoIds.length;

    // Initialize job
    const job: IngestionJob = {
      id: generateId(),
      playlistId,
      status: 'running',
      progress: { total: totalVideos, completed: 0, failed: 0 },
      errors: [],
      createdAt: now(),
    };

    // Process each video
    for (const videoId of playlist.videoIds) {
      try {
        const result = await this.processVideo(videoId);
        if (result.ok) {
          // Only count if newly created (not idempotent skip)
          if (result.value.created) {
            nodeIds.push(result.value.nodeId);
          }
          tagsAssigned += result.value.tagsAssigned;
          job.progress.completed++;
        } else {
          job.progress.failed++;
          errors.push({
            videoId,
            message: result.error.message,
            timestamp: now(),
          });
        }
      } catch (err) {
        job.progress.failed++;
        errors.push({
          videoId,
          message: err instanceof Error ? err.message : String(err),
          timestamp: now(),
        });
      }
    }

    // Finalize job
    job.status = totalVideos === 0
      ? 'completed'
      : errors.length === totalVideos
        ? 'failed'
        : 'completed';
    job.errors = errors;
    job.completedAt = now();

    return {
      ok: true,
      value: {
        job,
        videosProcessed: job.progress.completed,
        tagsAssigned,
        nodeIds,
      },
    };
  }

  /**
   * Ingest a single YouTube video.
   */
  async ingestVideo(videoId: string): Promise<Result<{ nodeId: string; tagsAssigned: number; created: boolean }>> {
    return this.processVideo(videoId);
  }

  /**
   * Process a single video.
   */
  private async processVideo(videoId: string): Promise<
    Result<{ nodeId: string; tagsAssigned: number; created: boolean }>
  > {
    const nodeId = `youtube-${videoId}`;
    const existingNode = await this.graphStore.getNode(nodeId);
    if (!existingNode.ok) {
      return { ok: false, error: existingNode.error };
    }
    if (existingNode.value) {
      this.processedVideos.add(videoId);
      let tagsAssigned = 0;
      const resource = existingNode.value;
      const excerptsResult = await this.graphStore.queryNodes({
        type: 'Excerpt',
        filters: { resourceId: nodeId },
      });
      if (!excerptsResult.ok) {
        return { ok: false, error: excerptsResult.error };
      }
      const hasExcerpts = excerptsResult.value.items.length > 0;
      const transcriptStatus = resource.metadata?.['transcriptStatus'];

      if (!hasExcerpts || transcriptStatus !== 'available') {
        const transcriptResult = await this.youtubeClient.fetchTranscript(videoId);
        const transcript = transcriptResult.ok ? transcriptResult.value : null;

        if (transcript) {
          const excerptResult = await this.storeTranscriptExcerpts(nodeId, videoId, transcript);
          if (!excerptResult.ok) {
            return { ok: false, error: excerptResult.error };
          }
          if (transcript.fullText) {
            tagsAssigned = await this.assignTags(nodeId, transcript.fullText);
          }
        }

        const updatedMetadata: Record<string, unknown> = {
          ...(resource.metadata as Record<string, unknown>),
          transcriptStatus: transcriptResult.ok ? 'available' : 'missing',
          transcriptError: transcriptResult.ok ? undefined : transcriptResult.error.message,
          transcriptLanguage: transcript?.language,
        };

        const updateData: NodeDataInput = {
          label: resource.label,
          content: transcript?.fullText ?? resource.content,
          metadata: updatedMetadata,
        };

        const updateResult = await this.graphStore.upsertNode('Resource', nodeId, updateData, { detectNoop: true });
        if (!updateResult.ok) {
          return { ok: false, error: updateResult.error };
        }
      }

      return {
        ok: true,
        value: { nodeId, tagsAssigned, created: false }
      };
    }

    // Fetch video metadata
    const videoResult = await this.youtubeClient.fetchVideo(videoId);
    if (!videoResult.ok) {
      return { ok: false, error: videoResult.error };
    }

    const video = videoResult.value;

    // Fetch transcript (optional, don't fail if unavailable)
    const transcriptResult = await this.youtubeClient.fetchTranscript(videoId);
    const transcript = transcriptResult.ok ? transcriptResult.value : null;
    const transcriptStatus = transcriptResult.ok ? 'available' : 'missing';
    const transcriptError = transcriptResult.ok ? undefined : transcriptResult.error.message;

    // Create graph node
    const nodeType: NodeType = 'Resource';
    const nodeData: NodeDataInput = {
      label: video.title,
      content: transcript?.fullText,
      metadata: {
        videoId: video.id,
        channelId: video.channelId,
        channelName: video.channelName,
        duration: video.duration,
        publishedAt: video.publishedAt,
        description: video.description,
        url: `https://www.youtube.com/watch?v=${video.id}`,
        source: 'youtube',
        thumbnailUrl: video.thumbnailUrl,
        transcriptStatus,
        transcriptError,
        transcriptLanguage: transcript?.language,
      },
    };

    const upsertResult = await this.graphStore.upsertNode(nodeType, nodeId, nodeData, { detectNoop: true });
    if (!upsertResult.ok) {
      return { ok: false, error: upsertResult.error };
    }

    // Mark as processed
    this.processedVideos.add(videoId);

    // Store transcript excerpts when available
    if (transcript) {
      const excerptResult = await this.storeTranscriptExcerpts(nodeId, video.id, transcript);
      if (!excerptResult.ok) {
        return { ok: false, error: excerptResult.error };
      }
    }

    // Assign tags based on content (simple keyword matching for MVP)
    let tagsAssigned = 0;
    if (transcript?.fullText) {
      const assigned = await this.assignTags(nodeId, transcript.fullText);
      tagsAssigned = assigned;
    }

    return {
      ok: true,
      value: { nodeId, tagsAssigned, created: upsertResult.value.created },
    };
  }

  /**
   * Simple tag assignment based on keyword matching.
   */
  private async assignTags(nodeId: string, content: string): Promise<number> {
    const tagsResult = await this.taxonomyRegistry.listTags();
    if (!tagsResult.ok) return 0;

    let assigned = 0;
    const contentLower = content.toLowerCase();

    for (const tag of tagsResult.value) {
      // Check if tag name or aliases appear in content
      const matches =
        contentLower.includes(tag.name.toLowerCase()) ||
        tag.aliases.some(alias => contentLower.includes(alias.toLowerCase()));

      if (matches) {
        const assignmentResult = await this.taxonomyRegistry.assignTag({
          nodeId,
          tagId: tag.id,
          confidence: 0.7,
          source: 'automatic',
        });
        if (assignmentResult.ok) {
          assigned++;
        }
      }
    }

    return assigned;
  }

  private async storeTranscriptExcerpts(
    resourceId: string,
    videoId: string,
    transcript: Transcript
  ): Promise<Result<{ created: number }>> {
    let created = 0;
    for (const [index, segment] of transcript.segments.entries()) {
      const excerptId = hashId('excerpt', [
        videoId,
        index,
        segment.start,
        segment.duration,
        segment.text,
      ]);
      const label = `Excerpt ${videoId} @${segment.start}s`;
      const data: NodeDataInput = {
        label,
        content: segment.text,
        metadata: {
          videoId,
          resourceId,
          start: segment.start,
          duration: segment.duration,
          end: segment.start + segment.duration,
          sequence: index,
          source: 'youtube',
        },
      };
      const upsert = await this.graphStore.upsertNode('Excerpt', excerptId, data, { detectNoop: true });
      if (!upsert.ok) return upsert;
      if (upsert.value.created) created++;

      const edge = await this.graphStore.upsertEdge(
        resourceId,
        'resourceHasExcerpt',
        excerptId,
        { metadata: { sequence: index, start: segment.start, duration: segment.duration } },
        { detectNoop: true }
      );
      if (!edge.ok) return edge;
    }

    return { ok: true, value: { created } };
  }
}
