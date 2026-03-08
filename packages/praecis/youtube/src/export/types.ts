export interface DossierClaim {
  id: string;
  text: string;
  state: 'draft' | 'accepted' | 'rejected';
  timestampSeconds: number;
  timestampLabel: string;
  timestampUrl: string;
  excerptText: string;
  excerptId?: string;
  referenceUrls: string[];
  type?: string;
  classification?: string;
  domain?: string;
  evidenceType?: string;
  confidence?: number;
  method?: string;
  /**
   * The maximum token overlap ratio between this claim and its source excerpts.
   * Values closer to 1.0 indicate near-exact transcript copies ("echoes").
   * Values closer to 0.0 indicate synthesized/rewritten assertions.
   */
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
