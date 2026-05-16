// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

/**
 * YouTube config module barrel export.
 *
 * @module
 */

export {
  SOURCE_ID,
  YouTubeSourceRegistration,
  resolveRawYoutubeActiveSourceConfigPaths,
} from './youtube-source-adapter.js';

export type {
  YtdlpConfig,
  YoutubeClientConfig,
  ResolvedYoutubeConfig,
} from './youtube-source-adapter.js';
