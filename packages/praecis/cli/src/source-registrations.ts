import type { SourceRegistration } from '@aidha/config';
import { YouTubeSourceRegistration } from '@aidha/ingestion-youtube/registration';
import { WebSourceRegistration } from '@aidha/praecis-source-web/registration';
import { PdfSourceRegistration } from '@aidha/praecis-source-pdf/registration';
import { VoiceSourceRegistration } from '@aidha/praecis-source-voice/registration';
import { MeetingSourceRegistration } from '@aidha/praecis-source-meetings/registration';
import { RssSourceRegistration, PodcastSourceRegistration } from '@aidha/praecis-source-feeds/registration';
import { ReadwiseSourceRegistration } from '@aidha/praecis-source-readwise/registration';
import { EmailSourceRegistration } from '@aidha/praecis-source-email/registration';
import { LinkedInSourceRegistration } from '@aidha/praecis-source-linkedin/registration';

export {
  YouTubeSourceRegistration,
  WebSourceRegistration,
  PdfSourceRegistration,
  VoiceSourceRegistration,
  MeetingSourceRegistration,
  RssSourceRegistration,
  PodcastSourceRegistration,
  ReadwiseSourceRegistration,
  EmailSourceRegistration,
  LinkedInSourceRegistration,
};

export const SOURCE_REGISTRATIONS: readonly SourceRegistration[] = [
  YouTubeSourceRegistration,
  WebSourceRegistration,
  PdfSourceRegistration,
  VoiceSourceRegistration,
  MeetingSourceRegistration,
  RssSourceRegistration,
  PodcastSourceRegistration,
  ReadwiseSourceRegistration,
  EmailSourceRegistration,
  LinkedInSourceRegistration,
];
