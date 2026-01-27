/**
 * Mock YouTube client for testing.
 *
 * Provides predictable test data without real API calls.
 */
import type { YouTubeClient, Result } from './types.js';
import type { Video, Playlist, Transcript } from '../schema/index.js';

/**
 * Mock data for testing.
 */
const MOCK_PLAYLISTS: Record<string, Playlist> = {
  'test-playlist': {
    id: 'test-playlist',
    title: 'Test Playlist',
    channelId: 'UC-test',
    channelName: 'Test Channel',
    videoIds: ['test-video', 'test-video-2'],
    description: 'A test playlist',
    publishedAt: '2025-01-01T00:00:00.000Z',
  },
  'empty-playlist': {
    id: 'empty-playlist',
    title: 'Empty Playlist',
    channelId: 'UC-test',
    channelName: 'Test Channel',
    videoIds: [],
    description: 'A playlist with no videos',
    publishedAt: '2025-01-01T00:00:00.000Z',
  },
};

const MOCK_VIDEOS: Record<string, Video> = {
  'test-video': {
    id: 'test-video',
    title: 'Test Video',
    channelId: 'UC-test',
    channelName: 'Test Channel',
    duration: 300,
    publishedAt: '2025-01-01T00:00:00.000Z',
    description: 'A test video about programming',
    thumbnailUrl: 'https://example.com/thumb.jpg',
  },
  'test-video-2': {
    id: 'test-video-2',
    title: 'Test Video 2',
    channelId: 'UC-test',
    channelName: 'Test Channel',
    duration: 600,
    publishedAt: '2025-01-02T00:00:00.000Z',
    description: 'Another test video',
  },
};

const MOCK_TRANSCRIPTS: Record<string, Transcript> = {
  'test-video': {
    videoId: 'test-video',
    language: 'en',
    segments: [
      { start: 0, duration: 5, text: 'Hello and welcome to this tutorial.' },
      { start: 5, duration: 5, text: 'Today we will learn about TypeScript.' },
    ],
    fullText: 'Hello and welcome to this tutorial. Today we will learn about TypeScript.',
  },
  'test-video-2': {
    videoId: 'test-video-2',
    language: 'en',
    segments: [
      { start: 0, duration: 10, text: 'This is the second video in our series.' },
    ],
    fullText: 'This is the second video in our series.',
  },
};

/**
 * Mock YouTube client for testing.
 */
export class MockYouTubeClient implements YouTubeClient {
  async fetchPlaylist(playlistId: string): Promise<Result<Playlist>> {
    const playlist = MOCK_PLAYLISTS[playlistId];
    if (!playlist) {
      return { ok: false, error: new Error(`Playlist not found: ${playlistId}`) };
    }
    return { ok: true, value: playlist };
  }

  async fetchVideo(videoId: string): Promise<Result<Video>> {
    const video = MOCK_VIDEOS[videoId];
    if (!video) {
      return { ok: false, error: new Error(`Video not found: ${videoId}`) };
    }
    return { ok: true, value: video };
  }

  async fetchTranscript(videoId: string): Promise<Result<Transcript>> {
    const transcript = MOCK_TRANSCRIPTS[videoId];
    if (!transcript) {
      return { ok: false, error: new Error(`Transcript not found: ${videoId}`) };
    }
    return { ok: true, value: transcript };
  }
}
