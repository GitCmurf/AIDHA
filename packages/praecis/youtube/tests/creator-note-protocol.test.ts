import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CreatorNoteAcquisition, CreatorNoteCaptureAttemptSchema, CreatorNoteCaptureSchema,
  creatorNoteContentIdentity, prepareCreatorNoteMetadata,
} from '../src/schema/creator-note.js';

const sourceCanonicalId = 'youtube-shownotefx1';
const sourceUrl = 'https://www.youtube.com/watch?v=shownotefx1';
const timestampA = '2026-10-18T12:00:00.000Z';
const timestampB = '2026-10-18T13:00:00.000Z';
const text = 'Guide: https://example.test/prompt\r\n';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const availableContent = hash(text);
const availableWire = '{"schemaVersion":1,"kind":"youtube-description","sourceCanonicalId":"youtube-shownotefx1","sourceUrl":"https://www.youtube.com/watch?v=shownotefx1","state":"available","contentSha256":"'
  + availableContent + '"}';
const emptyContent = hash('');
const emptyWire = '{"schemaVersion":1,"kind":"youtube-description","sourceCanonicalId":"youtube-shownotefx1","sourceUrl":"https://www.youtube.com/watch?v=shownotefx1","state":"empty","contentSha256":"'
  + emptyContent + '"}';
const unavailableWire = '{"schemaVersion":1,"kind":"youtube-description","sourceCanonicalId":"youtube-shownotefx1","sourceUrl":"https://www.youtube.com/watch?v=shownotefx1","state":"unavailable","contentSha256":null}';
const availableIdentity = hash(availableWire);
const emptyIdentity = hash(emptyWire);
const unavailableIdentity = hash(unavailableWire);

function identity(state: 'available' | 'empty' | 'unavailable', description: string | undefined) {
  return creatorNoteContentIdentity({ sourceCanonicalId, sourceUrl, state }, description);
}

describe('configured creator note protocol', () => {
  it('preserves exact ordered v1 identity hashes for all capture states', () => {
    const available = identity('available', text);
    expect(available).toEqual({
      schemaVersion: 1, kind: 'youtube-description', sourceCanonicalId, sourceUrl, state: 'available',
      contentSha256: availableContent, identitySha256: availableIdentity,
    });
    expect(identity('empty', '')).toMatchObject({
      state: 'empty', contentSha256: emptyContent, identitySha256: emptyIdentity,
    });
    expect(identity('unavailable', undefined)).toEqual({
      schemaVersion: 1, kind: 'youtube-description', sourceCanonicalId, sourceUrl,
      state: 'unavailable', contentSha256: null, identitySha256: unavailableIdentity,
    });
    const older = prepareCreatorNoteMetadata({ sourceCanonicalId, sourceUrl, description: text,
      acquisition: { state: 'available', method: 'youtube-watch-page' }, now: () => timestampA });
    const newer = prepareCreatorNoteMetadata({ sourceCanonicalId, sourceUrl, description: text,
      acquisition: { state: 'available', method: 'yt-dlp' }, now: () => timestampB });
    const olderCapture = CreatorNoteCaptureSchema.parse(older.metadata['creatorNoteCapture']);
    const newerCapture = CreatorNoteCaptureSchema.parse(newer.metadata['creatorNoteCapture']);
    expect(olderCapture.identitySha256).toBe(availableIdentity);
    expect(newerCapture.identitySha256).toBe(availableIdentity);
    expect([olderCapture.capturedAt, newerCapture.capturedAt]).toEqual([timestampA, timestampB]);
  });

  it.each(['yt-dlp', 'youtube-watch-page'] as const)('accepts existing method %s', method => {
    const result = prepareCreatorNoteMetadata({ sourceCanonicalId, sourceUrl, description: text,
      acquisition: { state: 'available', method }, now: () => timestampA });
    expect(CreatorNoteCaptureAttemptSchema.parse(result.metadata['creatorNoteCaptureAttempt']))
      .toMatchObject({ method, state: 'success', attemptedAt: timestampA });
  });

  it('keeps the legacy default, rejects unknown methods and binds one exact kind', () => {
    expect(prepareCreatorNoteMetadata({ sourceCanonicalId, sourceUrl, description: text,
      acquisition: { state: 'available' }, now: () => timestampA }).metadata['creatorNoteCaptureAttempt'])
      .toMatchObject({ method: 'yt-dlp', state: 'success' });
    expect(CreatorNoteAcquisition.safeParse({ state: 'available', method: 'invented' }).success).toBe(false);
    const capture = identity('available', text);
    expect(CreatorNoteCaptureSchema.safeParse({ ...capture, kind: 'other-description' }).success).toBe(false);
  });
});
