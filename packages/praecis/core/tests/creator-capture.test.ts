import { createHash } from 'node:crypto';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { createCreatorNoteProtocol, hasFailedCreatorNoteAttempt } from '../src/creator-capture.js';

const protocol = createCreatorNoteProtocol({
  kind: 'reader-description', methods: ['feed-reader', 'page-snapshot'], legacyDefaultMethod: 'feed-reader',
});
const { CreatorNoteAcquisition, CreatorNoteCaptureAttemptSchema, CreatorNoteCaptureSchema,
  creatorNoteContentIdentity, prepareCreatorNoteMetadata } = protocol;
type ProtocolAcquisition = z.infer<typeof protocol.CreatorNoteAcquisition>;

const sourceCanonicalId = 'source-item-17';
const sourceUrl = 'https://reader.example/items/17';
const timestampA = '2026-10-18T12:00:00.000Z';
const timestampB = '2026-10-18T13:00:00.000Z';
const text = 'Reading note: https://example.test/reference\r\n';
function prepare(acquisition: unknown, description: string | undefined) {
  return prepareCreatorNoteMetadata({ sourceCanonicalId, sourceUrl, description,
    acquisition: acquisition as ProtocolAcquisition, now: () => timestampA });
}

describe('generic creator capture protocol', () => {
  it('matches the stable JSON wire order and excludes capture timestamps from identity', () => {
    const contentSha256 = createHash('sha256').update(text).digest('hex');
    const stableJson = '{"schemaVersion":1,"kind":"reader-description","sourceCanonicalId":"'
      + sourceCanonicalId + '","sourceUrl":"' + sourceUrl + '","state":"available","contentSha256":"'
      + contentSha256 + '"}';
    const identitySha256 = createHash('sha256').update(stableJson).digest('hex');
    expect(creatorNoteContentIdentity({ sourceCanonicalId, sourceUrl, state: 'available' }, text)).toEqual({
      schemaVersion: 1, kind: 'reader-description', sourceCanonicalId, sourceUrl,
      state: 'available', contentSha256, identitySha256,
    });
    const a = prepareCreatorNoteMetadata({ sourceCanonicalId, sourceUrl, description: text,
      acquisition: { state: 'available', method: 'page-snapshot' }, now: () => timestampA });
    const b = prepareCreatorNoteMetadata({ sourceCanonicalId, sourceUrl, description: text,
      acquisition: { state: 'available', method: 'page-snapshot' }, now: () => timestampB });
    const ca = CreatorNoteCaptureSchema.parse(a.metadata['creatorNoteCapture']);
    const cb = CreatorNoteCaptureSchema.parse(b.metadata['creatorNoteCapture']);
    expect(ca.identitySha256).toBe(identitySha256);
    expect(cb.identitySha256).toBe(identitySha256);
    expect([ca.capturedAt, cb.capturedAt]).toEqual([timestampA, timestampB]);
  });

  it.each(['feed-reader', 'page-snapshot'] as const)('preserves configured method %s', method => {
    const result = prepare({ state: 'available', method }, text);
    expect(CreatorNoteCaptureAttemptSchema.parse(result.metadata['creatorNoteCaptureAttempt']))
      .toMatchObject({ method, state: 'success', attemptedAt: timestampA });
  });

  it('defaults to its configured legacy method and rejects unknown methods', () => {
    expect(prepare({ state: 'available' }, text).metadata['creatorNoteCaptureAttempt'])
      .toMatchObject({ method: 'feed-reader', state: 'success' });
    expect(CreatorNoteAcquisition.safeParse({ state: 'available', method: 'invented' }).success).toBe(false);
    expect(CreatorNoteCaptureAttemptSchema.safeParse({ schemaVersion: 1, method: 'invented', state: 'success',
      attemptedAt: timestampA }).success).toBe(false);
  });

  it('distinguishes available, empty and unavailable results', () => {
    const available = prepare({ state: 'available', method: 'page-snapshot' }, text);
    expect(available.description).toBe(text);
    expect(CreatorNoteCaptureSchema.parse(available.metadata['creatorNoteCapture']).state).toBe('available');
    const empty = prepare({ state: 'empty', method: 'page-snapshot' }, '');
    expect(empty.description).toBe('');
    expect(CreatorNoteCaptureSchema.parse(empty.metadata['creatorNoteCapture'])).toMatchObject({
      state: 'empty', contentSha256: createHash('sha256').update('').digest('hex'),
    });
    const unavailable = prepare({ state: 'unavailable', method: 'page-snapshot' }, 'stale text');
    expect(unavailable.description).toBeUndefined();
    expect(CreatorNoteCaptureSchema.parse(unavailable.metadata['creatorNoteCapture']))
      .toMatchObject({ state: 'unavailable', contentSha256: null });
    expect(unavailable.metadata['description']).toBeNull();
  });

  it('turns malformed payloads and failed outcomes into typed failures', () => {
    const malformed = prepare({ state: 'available', method: 'page-snapshot' }, '');
    expect(malformed.description).toBeUndefined();
    expect(malformed.metadata['creatorNoteCapture']).toBeUndefined();
    expect(malformed.metadata['creatorNoteCaptureAttempt']).toMatchObject({ method: 'page-snapshot', state: 'failed', reason: 'invalid-data' });
    const invalid = prepare({ state: 'invented', method: 'page-snapshot' }, text);
    expect(invalid.description).toBeUndefined();
    expect(invalid.metadata['creatorNoteCaptureAttempt']).toMatchObject({ method: 'feed-reader', state: 'failed', reason: 'invalid-data' });
    const failed = prepare({ state: 'failed', reason: 'timeout', method: 'page-snapshot' }, undefined);
    expect(failed.description).toBeUndefined();
    expect(failed.metadata['creatorNoteCaptureAttempt']).toMatchObject({ method: 'page-snapshot', state: 'failed', reason: 'timeout' });
    expect(hasFailedCreatorNoteAttempt(failed.metadata)).toBe(true);
    expect(hasFailedCreatorNoteAttempt({ creatorNoteCaptureAttempt: { schemaVersion: 1, method: 'feed-reader', state: 'not_configured', attemptedAt: timestampA } })).toBe(true);
  });

  it('keeps fresh legacy text unqualified and does not restamp stored retrievals', () => {
    expect(prepareCreatorNoteMetadata({ sourceCanonicalId, sourceUrl, description: text, now: () => timestampA }))
      .toEqual({ description: text, metadata: { description: text, creatorNoteCapture: null, creatorNoteCaptureAttempt: null } });
    expect(prepareCreatorNoteMetadata({ sourceCanonicalId, sourceUrl, description: text, storedRetrieval: true, now: () => timestampB }))
      .toEqual({ description: text, metadata: { description: text } });
    expect(hasFailedCreatorNoteAttempt({ creatorNoteCaptureAttempt: { schemaVersion: 1, method: 'feed-reader', state: 'success', attemptedAt: timestampA } })).toBe(false);
  });

  it('isolates kinds, method sets and defaults across configured instances', () => {
    const article = createCreatorNoteProtocol({ kind: 'article-text', methods: ['article-parser'], legacyDefaultMethod: 'article-parser' });
    const transcript = createCreatorNoteProtocol({ kind: 'audio-text', methods: ['audio-reader'], legacyDefaultMethod: 'audio-reader' });
    const articleResult = article.prepareCreatorNoteMetadata({
      sourceCanonicalId: 'opaque-item-42', sourceUrl: 'https://resource.example/items/42', description: text,
      acquisition: { state: 'available' }, now: () => timestampA,
    });
    const articleCapture = article.CreatorNoteCaptureSchema.parse(articleResult.metadata['creatorNoteCapture']);
    expect(articleCapture).toMatchObject({
      kind: 'article-text', sourceCanonicalId: 'opaque-item-42',
      sourceUrl: 'https://resource.example/items/42',
    });
    expect(article.CreatorNoteCaptureAttemptSchema.parse(articleResult.metadata['creatorNoteCaptureAttempt']))
      .toMatchObject({ method: 'article-parser' });
    expect(transcript.CreatorNoteCaptureSchema.safeParse(articleCapture).success).toBe(false);
    expect(transcript.CreatorNoteCaptureAttemptSchema.safeParse(articleResult.metadata['creatorNoteCaptureAttempt']).success).toBe(false);
    expect(article.CreatorNoteAcquisition.safeParse({ state: 'available', method: 'audio-reader' }).success).toBe(false);
    expect(transcript.CreatorNoteAcquisition.safeParse({ state: 'available', method: 'article-parser' }).success).toBe(false);
    expect(article.CreatorNoteCaptureSchema.safeParse({ ...articleCapture, kind: 'audio-text' }).success).toBe(false);
  });

  it('snapshots caller-owned protocol configuration at construction', () => {
    const configuration: { kind: string; methods: [string, string]; legacyDefaultMethod: string } = {
      kind: 'stable-text', methods: ['stable-reader', 'alternate-reader'], legacyDefaultMethod: 'stable-reader',
    };
    const bound = createCreatorNoteProtocol(configuration);
    configuration.kind = 'mutated-text';
    configuration.methods[0] = 'mutated-reader';
    configuration.legacyDefaultMethod = 'alternate-reader';

    const result = bound.prepareCreatorNoteMetadata({
      sourceCanonicalId: 'opaque-item-43', sourceUrl: 'https://resource.example/items/43', description: text,
      acquisition: { state: 'available' }, now: () => timestampA,
    });
    const capture = bound.CreatorNoteCaptureSchema.parse(result.metadata['creatorNoteCapture']);
    const attempt = bound.CreatorNoteCaptureAttemptSchema.parse(result.metadata['creatorNoteCaptureAttempt']);
    expect(capture.kind).toBe('stable-text');
    expect(attempt.method).toBe('stable-reader');
    expect(bound.CreatorNoteCaptureSchema.safeParse(capture).success).toBe(true);
  });
});
