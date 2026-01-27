/**
 * Real YouTube client implementation.
 *
 * Uses oEmbed API for metadata and Innertube API for transcripts
 * (same approach as youtube-transcript-api Python library).
 */
import type { YouTubeClient, Result } from './types.js';
import type { Video, Playlist, Transcript } from '../schema/index.js';

// Innertube API configuration
const INNERTUBE_API_KEY = process.env.YOUTUBE_INNERTUBE_API_KEY;
const INNERTUBE_CLIENT_VERSION = '2.20240101.00.00';

/**
 * Parse YouTube video ID from various URL formats.
 */
function parseVideoId(input: string): string {
  if (!input.includes('/') && !input.includes('.')) {
    return input;
  }

  try {
    const url = new URL(input);
    if (url.searchParams.has('v')) {
      return url.searchParams.get('v')!;
    }
    if (url.hostname === 'youtu.be') {
      return url.pathname.slice(1);
    }
    if (url.pathname.startsWith('/embed/')) {
      return url.pathname.slice(7);
    }
  } catch {
    // Not a URL, treat as ID
  }

  return input;
}

/**
 * Create Innertube API request context.
 */
function createInnertubeContext() {
  return {
    client: {
      hl: 'en',
      gl: 'US',
      clientName: 'WEB',
      clientVersion: INNERTUBE_CLIENT_VERSION,
    },
  };
}

/**
 * Fetch video metadata using oEmbed API.
 */
async function fetchOEmbed(videoId: string): Promise<Result<{
  title: string;
  author_name: string;
  author_url?: string;
  thumbnail_url: string;
}>> {
  try {
    const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const response = await fetch(url);

    if (!response.ok) {
      return { ok: false, error: new Error(`oEmbed failed: ${response.status}`) };
    }

    const data = await response.json() as {
      title: string;
      author_name: string;
      author_url?: string;
      thumbnail_url: string;
    };

    return { ok: true, value: data };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}

/**
 * Parse channel identifier from oEmbed author URL.
 */
function parseChannelId(authorUrl?: string): string {
  if (!authorUrl) return '';

  try {
    const url = new URL(authorUrl);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length >= 2 && parts[0] === 'channel') {
      return parts[1] ?? '';
    }
    if (parts.length >= 1) {
      return parts[parts.length - 1] ?? '';
    }
  } catch {
    // Ignore malformed URLs
  }

  return '';
}

/**
 * Extract caption tracks from video page using Innertube player response.
 */
async function fetchCaptionTracks(videoId: string): Promise<Result<Array<{
  baseUrl: string;
  languageCode: string;
  name: string;
}>>> {
  if (!INNERTUBE_API_KEY) {
    return {
      ok: false,
      error: new Error('Missing YOUTUBE_INNERTUBE_API_KEY env var for Innertube requests'),
    };
  }

  try {
    // Use Innertube player endpoint
    const response = await fetch(
      `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          context: createInnertubeContext(),
          videoId,
        }),
      }
    );

    if (!response.ok) {
      return { ok: false, error: new Error(`Innertube API failed: ${response.status}`) };
    }

    const data = await response.json() as {
      captions?: {
        playerCaptionsTracklistRenderer?: {
          captionTracks?: Array<{
            baseUrl: string;
            languageCode: string;
            name?: { simpleText?: string };
          }>;
        };
      };
    };

    const tracks = data.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!tracks || tracks.length === 0) {
      return { ok: false, error: new Error(`No captions available for ${videoId}`) };
    }

    return {
      ok: true,
      value: tracks.map(t => ({
        baseUrl: t.baseUrl,
        languageCode: t.languageCode,
        name: t.name?.simpleText ?? t.languageCode,
      })),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}

/**
 * Parse XML transcript into segments.
 */
function parseTranscriptXml(xml: string): Array<{ start: number; duration: number; text: string }> {
  const segments: Array<{ start: number; duration: number; text: string }> = [];
  const textMatches = xml.matchAll(/<text start="([^"]+)" dur="([^"]+)"[^>]*>([^<]*)<\/text>/g);

  for (const match of textMatches) {
    const start = parseFloat(match[1] ?? '0');
    const duration = parseFloat(match[2] ?? '0');
    const text = (match[3] ?? '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n/g, ' ')
      .trim();

    if (text) {
      segments.push({ start, duration, text });
    }
  }

  return segments;
}

/**
 * Real YouTube client using Innertube API (same approach as youtube-transcript-api).
 */
export class RealYouTubeClient implements YouTubeClient {
  /**
   * Fetch playlist - not supported without Data API key.
   */
  async fetchPlaylist(playlistId: string): Promise<Result<Playlist>> {
    return {
      ok: false,
      error: new Error(
        `Playlist fetching requires YouTube Data API key. ` +
        `Consider providing video IDs directly instead.`
      ),
    };
  }

  /**
   * Fetch video metadata using oEmbed.
   */
  async fetchVideo(videoIdOrUrl: string): Promise<Result<Video>> {
    const videoId = parseVideoId(videoIdOrUrl);

    try {
      const oembedResult = await fetchOEmbed(videoId);
      if (!oembedResult.ok) {
        return { ok: false, error: oembedResult.error };
      }

      const { title, author_name, author_url, thumbnail_url } = oembedResult.value;
      const channelId = parseChannelId(author_url) || author_name;

      const video: Video = {
        id: videoId,
        title,
        channelId,
        channelName: author_name,
        duration: 0,
        publishedAt: new Date().toISOString(),
        description: undefined,
        thumbnailUrl: thumbnail_url,
      };

      return { ok: true, value: video };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  /**
   * Fetch video transcript using Innertube API (like youtube-transcript-api).
   */
  async fetchTranscript(videoIdOrUrl: string): Promise<Result<Transcript>> {
    const videoId = parseVideoId(videoIdOrUrl);

    try {
      // Get caption tracks via Innertube API
      const tracksResult = await fetchCaptionTracks(videoId);
      if (!tracksResult.ok) {
        return { ok: false, error: tracksResult.error };
      }

      const tracks = tracksResult.value;

      // Find English track (prefer 'en', fallback to first)
      const englishTrack = tracks.find(t => t.languageCode === 'en') ?? tracks[0];
      if (!englishTrack) {
        return { ok: false, error: new Error(`No caption track found for ${videoId}`) };
      }

      // Fetch the transcript XML
      const transcriptResponse = await fetch(englishTrack.baseUrl);
      if (!transcriptResponse.ok) {
        return { ok: false, error: new Error(`Failed to fetch transcript: ${transcriptResponse.status}`) };
      }

      const transcriptXml = await transcriptResponse.text();
      const segments = parseTranscriptXml(transcriptXml);

      if (segments.length === 0) {
        return { ok: false, error: new Error(`No transcript segments found for ${videoId}`) };
      }

      const fullText = segments.map(s => s.text).join(' ');

      const transcript: Transcript = {
        videoId,
        language: englishTrack.languageCode,
        segments,
        fullText,
      };

      return { ok: true, value: transcript };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  /**
   * Fetch video with transcript together.
   */
  async fetchVideoWithTranscript(videoIdOrUrl: string): Promise<Result<{
    video: Video;
    transcript: Transcript | null;
  }>> {
    const videoResult = await this.fetchVideo(videoIdOrUrl);
    if (!videoResult.ok) {
      return { ok: false, error: videoResult.error };
    }

    const transcriptResult = await this.fetchTranscript(videoIdOrUrl);

    return {
      ok: true,
      value: {
        video: videoResult.value,
        transcript: transcriptResult.ok ? transcriptResult.value : null,
      },
    };
  }
}
