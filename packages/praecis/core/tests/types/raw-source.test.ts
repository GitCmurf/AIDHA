// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { describe, it, expect } from 'vitest';
import type { RawSource } from '../../src/types/index.js';

const baseProvenance = {
  ingestedAt: '2026-05-21T00:00:00Z',
  sourceType: 'web',
};

describe('RawSource', () => {
  it('accepts sensitivity value "public"', () => {
    const src: RawSource = {
      canonicalId: 'web:https://example.com/a',
      sourceType: 'web',
      sensitivity: 'public',
      provenance: baseProvenance,
      payload: { html: '<p>test</p>' },
      label: 'Example Page',
    };
    expect(src.sensitivity).toBe('public');
  });

  it('accepts sensitivity value "personal"', () => {
    const src: RawSource = {
      canonicalId: 'email:msg-abc',
      sourceType: 'email',
      sensitivity: 'personal',
      provenance: baseProvenance,
      payload: null,
      label: 'My Email',
    };
    expect(src.sensitivity).toBe('personal');
  });

  it('accepts sensitivity value "confidential"', () => {
    const src: RawSource = {
      canonicalId: 'doc:internal-001',
      sourceType: 'document',
      sensitivity: 'confidential',
      provenance: baseProvenance,
      payload: { path: '/tmp/doc.pdf' },
      label: 'Internal Doc',
    };
    expect(src.sensitivity).toBe('confidential');
  });

  it('dedupKeys is optional', () => {
    const withoutDedupKeys: RawSource = {
      canonicalId: 'web:https://example.com/a',
      sourceType: 'web',
      sensitivity: 'public',
      provenance: baseProvenance,
      payload: null,
      label: 'Page',
    };
    expect(withoutDedupKeys.dedupKeys).toBeUndefined();

    const withDedupKeys: RawSource = {
      canonicalId: 'web:https://example.com/a',
      dedupKeys: ['web:https://canonical.com/a', 'doi:10.1234/xyz'],
      sourceType: 'web',
      sensitivity: 'public',
      provenance: baseProvenance,
      payload: null,
      label: 'Page',
    };
    expect(withDedupKeys.dedupKeys).toHaveLength(2);
  });

  it('payload accepts unknown values', () => {
    const withStringPayload: RawSource = {
      canonicalId: 'test:1',
      sourceType: 'test',
      sensitivity: 'public',
      provenance: baseProvenance,
      payload: 'raw string',
      label: 'Test',
    };
    expect(withStringPayload.payload).toBe('raw string');

    const withObjectPayload: RawSource = {
      canonicalId: 'test:2',
      sourceType: 'test',
      sensitivity: 'public',
      provenance: baseProvenance,
      payload: { nested: { value: 42 } },
      label: 'Test',
    };
    expect((withObjectPayload.payload as { nested: { value: number } }).nested.value).toBe(42);
  });
});
