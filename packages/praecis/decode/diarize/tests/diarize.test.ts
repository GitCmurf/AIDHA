// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { describe, expect, it } from 'vitest';
import { MockDiarizer, NoOpDiarizer, normalizeDiarizedSegments } from '../src/index.js';

describe('normalizeDiarizedSegments', () => {
  it('fills missing speakers deterministically', () => {
    const normalized = normalizeDiarizedSegments([
      { id: 'a', startSec: 0, endSec: 1, text: 'hello' },
      { id: 'b', startSec: 1, endSec: 2, text: 'world', speaker: '  ' },
    ]);

    expect(normalized).toEqual([
      { id: 'a', startSec: 0, endSec: 1, text: 'hello', speaker: 'Speaker 1' },
      { id: 'b', startSec: 1, endSec: 2, text: 'world', speaker: 'Speaker 2' },
    ]);
  });
});

describe('MockDiarizer', () => {
  it('cycles configured speaker labels', async () => {
    const diarizer = new MockDiarizer({ speakerLabels: ['Alice', 'Bob'] });
    const result = await diarizer.diarize(
      { uri: 'file:///meeting.wav', mimeType: 'audio/wav' },
      [
        { id: 's1', startSec: 0, endSec: 5, text: 'first' },
        { id: 's2', startSec: 5, endSec: 10, text: 'second' },
        { id: 's3', startSec: 10, endSec: 15, text: 'third' },
      ],
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.map(segment => segment.speaker)).toEqual(['Alice', 'Bob', 'Alice']);
  });

  it('preserves explicit speaker labels', async () => {
    const diarizer = new MockDiarizer();
    const result = await diarizer.diarize(
      { uri: 'file:///meeting.wav', mimeType: 'audio/wav' },
      [{ id: 's1', startSec: 0, endSec: 5, text: 'first', speaker: 'Host' }],
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value[0]!.speaker).toBe('Host');
  });
});

describe('NoOpDiarizer', () => {
  it('normalizes without altering the segment order', async () => {
    const diarizer = new NoOpDiarizer();
    const result = await diarizer.diarize(
      { uri: 'file:///meeting.wav', mimeType: 'audio/wav' },
      [{ id: 's1', startSec: 0, endSec: 5, text: 'first' }],
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value[0]!.speaker).toBe('Speaker 1');
  });
});
