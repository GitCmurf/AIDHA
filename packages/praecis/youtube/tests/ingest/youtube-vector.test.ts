// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { describe, it, expect } from 'vitest';
import { MockYouTubeClient } from '../../src/client/mock.js';
import { createYouTubeVectorSpec } from '../../src/ingest/youtube-vector.js';
import { composeVector } from '@aidha/praecis-core';
import type { ResolvedConfig } from '@aidha/config';

const runtimeContext = {
  config: {} as ResolvedConfig,
  clock: { now: () => new Date('2026-05-25T12:34:56.000Z') },
};

describe('composeVector + YouTubeIngestor + TranscriptDecodeStrategy integration', () => {
  it('ingestAndDecode returns ok with non-empty segments containing timecode locators', async () => {
    const mockClient = new MockYouTubeClient();
    const spec = createYouTubeVectorSpec({ client: mockClient });
    const vector = composeVector(spec);

    const result = await vector.ingestAndDecode({ ref: 'test-video' }, runtimeContext);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { segments } = result.value;
    expect(segments.length).toBeGreaterThan(0);

    const hasTimecode = segments.some(seg => seg.locator.kind === 'timecode');
    expect(hasTimecode).toBe(true);
  });
});
