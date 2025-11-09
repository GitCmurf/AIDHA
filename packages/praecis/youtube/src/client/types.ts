/**
 * YouTube client interface.
 */
import type { Video, Playlist, Transcript } from '../schema/index.js';

/**
 * Result wrapper for client operations.
 */
export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/**
 * YouTube client interface.
 */
export interface YouTubeClient {
  /**
   * Fetch playlist metadata and video IDs.
   */
  fetchPlaylist(playlistId: string): Promise<Result<Playlist>>;

  /**
   * Fetch video metadata.
   */
  fetchVideo(videoId: string): Promise<Result<Video>>;

  /**
   * Fetch video transcript.
   */
  fetchTranscript(videoId: string): Promise<Result<Transcript>>;
}
