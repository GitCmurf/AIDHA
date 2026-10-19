import { z } from 'zod';
import {
  createCreatorNoteProtocol, CreatorNoteFailureReason,
} from '@aidha/praecis-core/creator-capture';

export { CreatorNoteFailureReason };

const creatorNoteProtocol = createCreatorNoteProtocol({
  kind: 'youtube-description',
  methods: ['yt-dlp', 'youtube-watch-page'],
  legacyDefaultMethod: 'yt-dlp',
});

export const {
  CreatorNoteAcquisition,
  CreatorNoteCaptureSchema,
  CreatorNoteCaptureAttemptSchema,
  creatorNoteContentIdentity,
  prepareCreatorNoteMetadata,
} = creatorNoteProtocol;

export type CreatorNoteAcquisition = z.infer<typeof CreatorNoteAcquisition>;
export type CreatorNoteCapture = z.infer<typeof CreatorNoteCaptureSchema>;
export type CreatorNoteCaptureAttempt = z.infer<typeof CreatorNoteCaptureAttemptSchema>;

export const CREATOR_NOTE_METADATA_GROUP = {
  id: 'youtube-creator-notes-v1',
  fields: ['description', 'creatorNoteCapture', 'creatorNoteCaptureAttempt'],
} as const;
