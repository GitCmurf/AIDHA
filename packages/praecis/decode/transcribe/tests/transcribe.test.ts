// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { describe, expect, it } from 'vitest';
import { MockTranscriber, normalizeTranscriptionSegments } from '../src/index.js';

describe('normalizeTranscriptionSegments', () => {
  it('trims empty leading and trailing segments', () => {
    const normalized = normalizeTranscriptionSegments([
      { id: 'a', startSec: 0, endSec: 1, text: '   ' },
      { id: 'b', startSec: 1, endSec: 2, text: 'hello' },
      { id: 'c', startSec: 2, endSec: 3, text: '' },
    ]);

    expect(normalized).toEqual([
      { id: 'b', startSec: 1, endSec: 2, text: 'hello' },
    ]);
  });

  it('preserves non-empty segments and trims inner whitespace', () => {
    const normalized = normalizeTranscriptionSegments([
      { id: 'a', startSec: 0, endSec: 1, text: '  hello world  ' },
    ]);

    expect(normalized).toEqual([
      { id: 'a', startSec: 0, endSec: 1, text: 'hello world' },
    ]);
  });
});

describe('MockTranscriber', () => {
  it('returns deterministic segments from configured transcript text', async () => {
    const transcriber = new MockTranscriber({ transcriptText: 'one two three four five six seven eight' });
    const result = await transcriber.transcribe(
      { uri: 'file:///sample.wav', mimeType: 'audio/wav' },
      {}
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.length).toBeGreaterThan(0);
    expect(result.value[0]!.text.length).toBeGreaterThan(0);
  });

  it('uses explicit segments when provided', async () => {
    const transcriber = new MockTranscriber({
      segments: [
        { id: 's0', startSec: 0, endSec: 5, text: 'alpha' },
        { id: 's1', startSec: 5, endSec: 10, text: 'beta' },
      ],
    });

    const result = await transcriber.transcribe(
      { uri: 'file:///sample.wav', mimeType: 'audio/wav' },
      {}
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.map(segment => segment.id)).toEqual(['s0', 's1']);
  });

  it('is deterministic for the same input', async () => {
    const transcriber = new MockTranscriber({ transcriptText: 'alpha beta gamma delta epsilon zeta' });
    const first = await transcriber.transcribe({ uri: 'file:///sample.wav', mimeType: 'audio/wav' }, {});
    const second = await transcriber.transcribe({ uri: 'file:///sample.wav', mimeType: 'audio/wav' }, {});

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value).toEqual(second.value);
  });
});
