import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CreatorNoteAcquisition, CreatorNoteCaptureAttemptSchema, CreatorNoteCaptureSchema,
  creatorNoteContentIdentity, hasFailedCreatorNoteAttempt, prepareCreatorNoteMetadata } from '../src/creator-capture.js';

const sourceCanonicalId = 'youtube-shownotefx1';
const sourceUrl = 'https://www.youtube.com/watch?v=shownotefx1';
const timestampA = '2026-10-18T12:00:00.000Z';
const timestampB = '2026-10-18T13:00:00.000Z';
const text = 'Guide: https://example.test/prompt\r\n';
function prepare(acquisition: unknown, description: string | undefined) {
  return prepareCreatorNoteMetadata({ sourceCanonicalId, sourceUrl, description,
    acquisition: acquisition as CreatorNoteAcquisition, now: () => timestampA });
}

describe('creator capture', () => {
  it('matches v1 stable JSON wire order and excludes capture timestamps from identity', () => {
    const contentSha256 = createHash('sha256').update(text).digest('hex');
    const stableJson = `{"schemaVersion":1,"kind":"youtube-description","sourceCanonicalId":"${sourceCanonicalId}","sourceUrl":"${sourceUrl}","state":"available","contentSha256":"${contentSha256}"}`;
    const identitySha256 = createHash('sha256').update(stableJson).digest('hex');
    expect(creatorNoteContentIdentity({ sourceCanonicalId, sourceUrl, state: 'available' }, text)).toEqual({
      schemaVersion: 1, kind: 'youtube-description', sourceCanonicalId, sourceUrl,
      state: 'available', contentSha256, identitySha256,
    });
    const a = prepareCreatorNoteMetadata({ sourceCanonicalId, sourceUrl, description: text,
      acquisition: { state: 'available', method: 'youtube-watch-page' }, now: () => timestampA });
    const b = prepareCreatorNoteMetadata({ sourceCanonicalId, sourceUrl, description: text,
      acquisition: { state: 'available', method: 'youtube-watch-page' }, now: () => timestampB });
    const ca = CreatorNoteCaptureSchema.parse(a.metadata['creatorNoteCapture']);
    const cb = CreatorNoteCaptureSchema.parse(b.metadata['creatorNoteCapture']);
    expect(ca.identitySha256).toBe(identitySha256); expect(cb.identitySha256).toBe(identitySha256);
    expect([ca.capturedAt, cb.capturedAt]).toEqual([timestampA, timestampB]);
  });
  it.each(['yt-dlp', 'youtube-watch-page'] as const)('preserves known method %s', method => {
    const result = prepare({ state: 'available', method }, text);
    expect(CreatorNoteCaptureAttemptSchema.parse(result.metadata['creatorNoteCaptureAttempt']))
      .toMatchObject({ method, state: 'success', attemptedAt: timestampA });
  });
  it('defaults legacy method and rejects unknown methods', () => {
    expect(prepare({ state: 'available' }, text).metadata['creatorNoteCaptureAttempt'])
      .toMatchObject({ method: 'yt-dlp', state: 'success' });
    expect(CreatorNoteAcquisition.safeParse({ state: 'available', method: 'invented' }).success).toBe(false);
    expect(CreatorNoteCaptureAttemptSchema.safeParse({ schemaVersion: 1, method: 'invented', state: 'success',
      attemptedAt: timestampA }).success).toBe(false);
  });
  it('distinguishes available, empty and unavailable results', () => {
    const available = prepare({ state: 'available', method: 'youtube-watch-page' }, text);
    expect(available.description).toBe(text);
    expect(CreatorNoteCaptureSchema.parse(available.metadata['creatorNoteCapture']).state).toBe('available');
    const empty = prepare({ state: 'empty', method: 'youtube-watch-page' }, '');
    expect(empty.description).toBe('');
    expect(CreatorNoteCaptureSchema.parse(empty.metadata['creatorNoteCapture'])).toMatchObject({
      state: 'empty', contentSha256: createHash('sha256').update('').digest('hex'),
    });
    const unavailable = prepare({ state: 'unavailable', method: 'youtube-watch-page' }, 'stale text');
    expect(unavailable.description).toBeUndefined();
    expect(CreatorNoteCaptureSchema.parse(unavailable.metadata['creatorNoteCapture']))
      .toMatchObject({ state: 'unavailable', contentSha256: null });
    expect(unavailable.metadata['description']).toBeNull();
  });
  it('turns malformed payloads and failed outcomes into typed failures', () => {
    const malformed = prepare({ state: 'available', method: 'youtube-watch-page' }, '');
    expect(malformed.description).toBeUndefined();
    expect(malformed.metadata['creatorNoteCapture']).toBeUndefined();
    expect(malformed.metadata['creatorNoteCaptureAttempt']).toMatchObject({ method: 'youtube-watch-page', state: 'failed', reason: 'invalid-data' });
    const invalid = prepare({ state: 'invented', method: 'youtube-watch-page' }, text);
    expect(invalid.description).toBeUndefined();
    expect(invalid.metadata['creatorNoteCaptureAttempt']).toMatchObject({ method: 'yt-dlp', state: 'failed', reason: 'invalid-data' });
    const failed = prepare({ state: 'failed', reason: 'timeout', method: 'youtube-watch-page' }, undefined);
    expect(failed.description).toBeUndefined();
    expect(failed.metadata['creatorNoteCapture']).toBeUndefined();
    expect(failed.metadata['creatorNoteCaptureAttempt']).toMatchObject({ method: 'youtube-watch-page', state: 'failed', reason: 'timeout' });
    expect(hasFailedCreatorNoteAttempt(failed.metadata)).toBe(true);
    expect(hasFailedCreatorNoteAttempt({ creatorNoteCaptureAttempt: { schemaVersion: 1, method: 'yt-dlp', state: 'not_configured', attemptedAt: timestampA } })).toBe(true);
  });
  it('keeps fresh legacy text unqualified and does not restamp stored retrievals', () => {
    expect(prepareCreatorNoteMetadata({ sourceCanonicalId, sourceUrl, description: text, now: () => timestampA }))
      .toEqual({ description: text, metadata: { description: text, creatorNoteCapture: null, creatorNoteCaptureAttempt: null } });
    expect(prepareCreatorNoteMetadata({ sourceCanonicalId, sourceUrl, description: text, storedRetrieval: true, now: () => timestampB }))
      .toEqual({ description: text, metadata: { description: text } });
    expect(hasFailedCreatorNoteAttempt({ creatorNoteCaptureAttempt: { schemaVersion: 1, method: 'yt-dlp', state: 'success', attemptedAt: timestampA } })).toBe(false);
  });
});
