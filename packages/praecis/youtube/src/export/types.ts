// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

export type ClaimState = 'draft' | 'accepted' | 'rejected';

export interface DossierClaim {
  id: string;
  text: string;
  state: ClaimState;
  timestampSeconds: number;
  label: string;
  deepLink: string;
  excerptText: string;
  excerptId?: string;
  speaker?: string;
  referenceUrls: string[];
  type?: string;
  classification?: string;
  domain?: string;
  evidenceType?: string;
  confidence?: number;
  method?: string;
  echoOverlapRatio?: number;
}

export interface VideoDossier {
  resourceId: string;
  videoId: string;
  title: string;
  channelName?: string;
  url: string;
  claims: DossierClaim[];
  references: string[];
}

export interface PlaylistDossier {
  playlistId: string;
  title?: string;
  url?: string;
  videos: VideoDossier[];
}

export interface PlaylistDossierInput {
  playlistId: string;
  videoIds: string[];
  title?: string;
  url?: string;
}

export interface TranscriptSegmentExport {
  id: string;
  start: number;
  end: number;
  duration: number;
  text: string;
  speaker?: string;
}

export interface TranscriptExport {
  videoId: string;
  resourceId: string;
  title: string;
  url: string;
  segments: TranscriptSegmentExport[];
}

export interface PlaylistTranscriptExport {
  playlistId: string;
  title?: string;
  url?: string;
  videos: TranscriptExport[];
}
