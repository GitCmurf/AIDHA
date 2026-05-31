// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { describe, it, expect } from 'vitest';
import {
  SourceType,
  LocatorSchema,
  ResourceMetadataSchema,
  ExcerptMetadataSchema,
  ClaimMetadataSchema,
  TaxonomyAssignmentMetadataSchema,
} from '../../src/schema/index.js';

describe('SourceType', () => {
  it('includes all new multi-vector values', () => {
    const values = SourceType.options;
    expect(values).toContain('web');
    expect(values).toContain('pdf');
    expect(values).toContain('document');
    expect(values).toContain('rss');
    expect(values).toContain('podcast');
    expect(values).toContain('voice');
    expect(values).toContain('meeting');
    expect(values).toContain('readwise');
    expect(values).toContain('email');
    expect(values).toContain('linkedin');
  });

  it('retains legacy values for backward compat', () => {
    const values = SourceType.options;
    expect(values).toContain('youtube');
    expect(values).toContain('article');
    expect(values).toContain('book');
    expect(values).toContain('note');
    expect(values).toContain('import');
    expect(values).toContain('generated');
  });
});

describe('LocatorSchema', () => {
  it('validates a timecode locator', () => {
    const result = LocatorSchema.safeParse({
      kind: 'timecode',
      startSec: 10.5,
      endSec: 25.0,
      speaker: 'Alice',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.kind).toBe('timecode');
  });

  it('validates a timecode locator without speaker', () => {
    const result = LocatorSchema.safeParse({ kind: 'timecode', startSec: 0, endSec: 5 });
    expect(result.success).toBe(true);
  });

  it('validates a page locator', () => {
    const result = LocatorSchema.safeParse({ kind: 'page', page: 3, charStart: 100, charEnd: 200 });
    expect(result.success).toBe(true);
  });

  it('validates a dom locator', () => {
    const result = LocatorSchema.safeParse({ kind: 'dom', textFragment: 'hello', charStart: 0, charEnd: 5 });
    expect(result.success).toBe(true);
  });

  it('validates a message locator', () => {
    const result = LocatorSchema.safeParse({ kind: 'message', messageId: 'msg-001', charStart: 0, charEnd: 50 });
    expect(result.success).toBe(true);
  });

  it('validates a text locator', () => {
    const result = LocatorSchema.safeParse({ kind: 'text', charStart: 0, charEnd: 100 });
    expect(result.success).toBe(true);
  });

  it('validates an external locator', () => {
    const result = LocatorSchema.safeParse({ kind: 'external', system: 'readwise', externalId: 'rw-999' });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown kind', () => {
    const result = LocatorSchema.safeParse({ kind: 'unknown', data: 'foo' });
    expect(result.success).toBe(false);
  });
});

describe('ExcerptMetadataSchema', () => {
  it('validates a full excerpt with timecode locator', () => {
    const result = ExcerptMetadataSchema.safeParse({
      resourceId: 'res-001',
      locator: { kind: 'timecode', startSec: 60, endSec: 90, speaker: 'Host' },
      sequence: 5,
      speaker: 'Host',
      section: 'Introduction',
    });
    expect(result.success).toBe(true);
  });

  it('allows missing locator (backward compat)', () => {
    const result = ExcerptMetadataSchema.safeParse({ resourceId: 'res-001', sequence: 1 });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.locator).toBeUndefined();
  });

  it('allows completely empty input', () => {
    const result = ExcerptMetadataSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe('ResourceMetadataSchema', () => {
  it('validates canonicalId and dedupKeys', () => {
    const result = ResourceMetadataSchema.safeParse({
      canonicalId: 'yt:dQw4w9WgXcQ',
      dedupKeys: ['youtube:dQw4w9WgXcQ', 'url:https://youtu.be/dQw4w9WgXcQ'],
      sourceType: 'youtube',
      label: 'Never Gonna Give You Up',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.canonicalId).toBe('yt:dQw4w9WgXcQ');
    expect(result.data.dedupKeys).toHaveLength(2);
  });

  it('defaults provenances to empty array', () => {
    const result = ResourceMetadataSchema.safeParse({});
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.provenances).toEqual([]);
  });

  it('validates provenances array', () => {
    const result = ResourceMetadataSchema.safeParse({
      provenances: [
        { sourceType: 'youtube', ingestedAt: '2026-05-21T10:00:00.000Z' },
      ],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.provenances).toHaveLength(1);
  });

  it('validates durable taxonomy assignments', () => {
    const result = ResourceMetadataSchema.safeParse({
      canonicalId: 'web:https://example.com',
      sourceType: 'web',
      taxonomyAssignments: [{
        nodeId: 'web:https://example.com',
        tagId: 'tag-1',
        confidence: 0.7,
        source: 'automatic',
        assignedBy: 'praecis-keyword-classifier',
        assignedAt: '2026-05-25T12:00:00.000Z',
      }],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.taxonomyAssignments?.[0]?.tagId).toBe('tag-1');
  });

  it('rejects malformed taxonomy assignments', () => {
    const result = TaxonomyAssignmentMetadataSchema.safeParse({
      nodeId: 'web:https://example.com',
      tagId: 'tag-1',
      confidence: 1.5,
      source: 'automatic',
      assignedAt: 'not-a-date',
    });

    expect(result.success).toBe(false);
  });
});

describe('ClaimMetadataSchema', () => {
  it('validates state and confidence', () => {
    const result = ClaimMetadataSchema.safeParse({ state: 'accepted', confidence: 0.85 });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.state).toBe('accepted');
    expect(result.data.confidence).toBe(0.85);
  });

  it('validates claim-grain routing review metadata', () => {
    const result = ClaimMetadataSchema.safeParse({
      state: 'accepted',
      routingReviewStatus: 'unreviewed',
      routingReviewReason: 'Low confidence automatic routing.',
      reviewPriority: {
        score: 30,
        reasons: ['low_confidence'],
        summary: 'low_confidence',
      },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.routingReviewStatus).toBe('unreviewed');
    expect(result.data.reviewPriority?.reasons).toEqual(['low_confidence']);
  });

  it('rejects invalid state', () => {
    const result = ClaimMetadataSchema.safeParse({ state: 'unknown-state' });
    expect(result.success).toBe(false);
  });

  it('rejects confidence out of range', () => {
    const result = ClaimMetadataSchema.safeParse({ confidence: 1.5 });
    expect(result.success).toBe(false);
  });

  it('allows additional metadata fields via passthrough', () => {
    const result = ClaimMetadataSchema.safeParse({
      state: 'draft',
      customField: 'value',
      nestedData: { key: 'value' },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect((result.data as Record<string, unknown>)['customField']).toBe('value');
  });
});
