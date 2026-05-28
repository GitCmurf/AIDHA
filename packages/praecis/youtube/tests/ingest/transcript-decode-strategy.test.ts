// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { describe, it, expect } from 'vitest';
import { TranscriptDecodeStrategy } from '../../src/ingest/transcript-decode-strategy.js';
import type { DecodeInput } from '@aidha/praecis-core';
import type { RawSource } from '@aidha/praecis-core';
import type { YouTubeVideoPayload } from '../../src/ingest/youtube-ingestor.js';
import type { ResolvedConfig } from '@aidha/config';

function makeRaw(payload: YouTubeVideoPayload): RawSource {
  return {
    canonicalId: `youtube:${payload.videoId}`,
    sourceType: 'YouTubeVideo',
    sensitivity: 'public',
    provenance: {
      sourceUri: `https://www.youtube.com/watch?v=${payload.videoId}`,
      ingestedAt: new Date().toISOString(),
      sourceType: 'YouTubeVideo',
    },
    label: payload.title,
    payload,
  };
}

function makeDecodeInput(payload: YouTubeVideoPayload): DecodeInput {
  return {
    raw: makeRaw(payload),
    config: {} as ResolvedConfig,
  };
}

const MOCK_PAYLOAD: YouTubeVideoPayload = {
  videoId: 'test-video',
  title: 'Test Video',
  channelId: 'UC-test',
  channelName: 'Test Channel',
  duration: 300,
  publishedAt: '2025-01-01T00:00:00.000Z',
  transcript: {
    videoId: 'test-video',
    language: 'en',
    segments: [
      { start: 0, duration: 5, speaker: 'Host', text: 'Hello and welcome.' },
      { start: 5, duration: 7, text: 'Today we cover TypeScript.' },
    ],
    fullText: 'Hello and welcome. Today we cover TypeScript.',
  },
};

describe('TranscriptDecodeStrategy', () => {
  const strategy = new TranscriptDecodeStrategy();

  it('has name "transcript:youtube"', () => {
    expect(strategy.name).toBe('transcript:youtube');
  });

  it('decodes transcript segments into MediaSegments with timecode locators', async () => {
    const result = await strategy.decode(makeDecodeInput(MOCK_PAYLOAD));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { segments } = result.value;
    expect(segments).toHaveLength(2);

    const [seg0, seg1] = segments;

    expect(seg0.locator.kind).toBe('timecode');
    if (seg0.locator.kind !== 'timecode') return;
    expect(seg0.locator.startSec).toBe(0);
    expect(seg0.locator.endSec).toBe(5);
    expect(seg0.text).toBe('Hello and welcome.');
    expect(seg0.label).toBe('Host');

    expect(seg1.locator.kind).toBe('timecode');
    if (seg1.locator.kind !== 'timecode') return;
    expect(seg1.locator.startSec).toBe(5);
    expect(seg1.locator.endSec).toBe(12);
    expect(seg1.text).toBe('Today we cover TypeScript.');
    expect(seg1.label).toBeUndefined();
  });

  it('generates deterministic stable IDs', async () => {
    const result1 = await strategy.decode(makeDecodeInput(MOCK_PAYLOAD));
    const result2 = await strategy.decode(makeDecodeInput(MOCK_PAYLOAD));

    expect(result1.ok).toBe(true);
    expect(result2.ok).toBe(true);
    if (!result1.ok || !result2.ok) return;

    const ids1 = result1.value.segments.map(s => s.id);
    const ids2 = result2.value.segments.map(s => s.id);
    expect(ids1).toEqual(ids2);
  });

  it('IDs start with "seg-" prefix', async () => {
    const result = await strategy.decode(makeDecodeInput(MOCK_PAYLOAD));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const seg of result.value.segments) {
      expect(seg.id).toMatch(/^seg-/);
    }
  });

  it('returns speaker on timecode locator when present', async () => {
    const result = await strategy.decode(makeDecodeInput(MOCK_PAYLOAD));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const seg0 = result.value.segments[0];
    expect(seg0.locator.kind).toBe('timecode');
    if (seg0.locator.kind !== 'timecode') return;
    expect(seg0.locator.speaker).toBe('Host');
  });

  it('returns error when transcript is null', async () => {
    const payloadNoTranscript: YouTubeVideoPayload = { ...MOCK_PAYLOAD, transcript: null };
    const result = await strategy.decode(makeDecodeInput(payloadNoTranscript));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('no transcript');
  });

  it('returns empty warnings array on success', async () => {
    const result = await strategy.decode(makeDecodeInput(MOCK_PAYLOAD));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.warnings).toEqual([]);
  });
});
