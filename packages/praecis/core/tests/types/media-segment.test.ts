// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { describe, it, expect } from 'vitest';
import type { MediaSegment } from '../../src/types/index.js';

describe('MediaSegment', () => {
  it('requires id and locator', () => {
    const seg: MediaSegment = {
      id: 'seg-001',
      locator: { kind: 'timecode', startSec: 0, endSec: 10 },
    };
    expect(seg.id).toBe('seg-001');
    expect(seg.locator.kind).toBe('timecode');
  });

  it('text is optional and independent of mediaRef', () => {
    const withText: MediaSegment = {
      id: 'seg-002',
      locator: { kind: 'text', charStart: 0, charEnd: 5 },
      text: 'hello',
    };
    expect(withText.text).toBe('hello');
    expect(withText.mediaRef).toBeUndefined();
  });

  it('mediaRef is optional and independent of text', () => {
    const withMedia: MediaSegment = {
      id: 'seg-003',
      locator: { kind: 'timecode', startSec: 30, endSec: 60 },
      mediaRef: { uri: 'file:///tmp/clip.mp4', mimeType: 'video/mp4', startSec: 30, endSec: 60 },
    };
    expect(withMedia.mediaRef?.uri).toBe('file:///tmp/clip.mp4');
    expect(withMedia.text).toBeUndefined();
  });

  it('both text and mediaRef can coexist', () => {
    const both: MediaSegment = {
      id: 'seg-004',
      locator: { kind: 'timecode', startSec: 0, endSec: 5 },
      text: 'transcript',
      mediaRef: { uri: 's3://bucket/clip.mp4', mimeType: 'video/mp4' },
    };
    expect(both.text).toBe('transcript');
    expect(both.mediaRef?.mimeType).toBe('video/mp4');
  });
});
