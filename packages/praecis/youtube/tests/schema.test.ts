/**
 * Schema tests - WRITTEN FIRST (TDD Red Phase)
 *
 * These tests define the expected behavior of our schemas.
 * Implementation follows to make them pass.
 */
import { describe, it, expect } from 'vitest';
import {
  Video,
  Playlist,
  Transcript,
  TranscriptSegment,
  IngestionJob,
  JobStatus,
} from '../src/schema/index.js';

describe('Video schema', () => {
  const validVideo = {
    id: 'dQw4w9WgXcQ',
    title: 'Test Video',
    channelId: 'UC123',
    channelName: 'Test Channel',
    duration: 212, // seconds
    publishedAt: '2025-01-01T00:00:00.000Z',
    description: 'A test video description',
    thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/default.jpg',
  };

  it('accepts valid video data', () => {
    const result = Video.safeParse(validVideo);
    expect(result.success).toBe(true);
  });

  it('rejects empty video ID', () => {
    const invalid = { ...validVideo, id: '' };
    const result = Video.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects negative duration', () => {
    const invalid = { ...validVideo, duration: -10 };
    const result = Video.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects invalid datetime format', () => {
    const invalid = { ...validVideo, publishedAt: 'not-a-date' };
    const result = Video.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('allows optional description', () => {
    const { description, ...withoutDesc } = validVideo;
    const result = Video.safeParse(withoutDesc);
    expect(result.success).toBe(true);
  });
});

describe('Playlist schema', () => {
  const validPlaylist = {
    id: 'PLrAXtmErZgOeiKm4',
    title: 'Test Playlist',
    channelId: 'UC123',
    channelName: 'Test Channel',
    videoIds: ['vid1', 'vid2', 'vid3'],
    description: 'A playlist',
    publishedAt: '2025-01-01T00:00:00.000Z',
  };

  it('accepts valid playlist', () => {
    const result = Playlist.safeParse(validPlaylist);
    expect(result.success).toBe(true);
  });

  it('allows empty videoIds array', () => {
    const empty = { ...validPlaylist, videoIds: [] };
    const result = Playlist.safeParse(empty);
    expect(result.success).toBe(true);
  });

  it('rejects missing channelId', () => {
    const { channelId, ...invalid } = validPlaylist;
    const result = Playlist.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe('Transcript schema', () => {
  const validSegment = {
    start: 0,
    duration: 5.2,
    text: 'Hello world',
  };

  const validTranscript = {
    videoId: 'dQw4w9WgXcQ',
    language: 'en',
    segments: [validSegment],
    fullText: 'Hello world',
  };

  it('accepts valid transcript segment', () => {
    const result = TranscriptSegment.safeParse(validSegment);
    expect(result.success).toBe(true);
  });

  it('rejects negative start time', () => {
    const invalid = { ...validSegment, start: -1 };
    const result = TranscriptSegment.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('accepts valid transcript', () => {
    const result = Transcript.safeParse(validTranscript);
    expect(result.success).toBe(true);
  });

  it('requires at least one segment', () => {
    const invalid = { ...validTranscript, segments: [] };
    const result = Transcript.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe('IngestionJob schema', () => {
  const validJob = {
    id: 'job-123',
    playlistId: 'PLrAXtmErZgOeiKm4',
    status: 'pending' as const,
    progress: { total: 10, completed: 0, failed: 0 },
    errors: [],
    createdAt: '2025-01-01T00:00:00.000Z',
  };

  it('accepts valid job', () => {
    const result = IngestionJob.safeParse(validJob);
    expect(result.success).toBe(true);
  });

  it('validates status enum', () => {
    expect(JobStatus.options).toContain('pending');
    expect(JobStatus.options).toContain('running');
    expect(JobStatus.options).toContain('completed');
    expect(JobStatus.options).toContain('failed');
  });

  it('tracks progress correctly', () => {
    const inProgress = {
      ...validJob,
      status: 'running' as const,
      progress: { total: 10, completed: 5, failed: 1 },
    };
    const result = IngestionJob.safeParse(inProgress);
    expect(result.success).toBe(true);
  });

  it('allows optional completedAt', () => {
    const completed = {
      ...validJob,
      status: 'completed' as const,
      completedAt: '2025-01-01T01:00:00.000Z',
    };
    const result = IngestionJob.safeParse(completed);
    expect(result.success).toBe(true);
  });
});
