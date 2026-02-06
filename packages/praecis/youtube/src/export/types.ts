export interface DossierClaim {
  id: string;
  text: string;
  timestampSeconds: number;
  timestampLabel: string;
  timestampUrl: string;
  excerptText: string;
  excerptId?: string;
  referenceUrls: string[];
  type?: string;
  confidence?: number;
  method?: string;
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
