// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import type { IDecodeStrategy, DecodeInput, DecodeOutput } from '@aidha/praecis-core';
import type { MediaSegment } from '@aidha/praecis-core';
import type { Result } from '@aidha/taxonomy';
import type { YouTubeVideoPayload } from './youtube-ingestor.js';
import { hashId } from '../utils/ids.js';

// ── TranscriptDecodeStrategy ──────────────────────────────────────────────────

export class TranscriptDecodeStrategy implements IDecodeStrategy {
  readonly name = 'transcript:youtube';

  async decode(input: DecodeInput): Promise<Result<DecodeOutput>> {
    const payload = input.raw.payload as YouTubeVideoPayload;

    if (!payload.transcript) {
      return {
        ok: false,
        error: new Error(
          `TranscriptDecodeStrategy: no transcript in payload for ${input.raw.canonicalId}`,
        ),
      };
    }

    const { videoId, transcript } = payload;

    const segments: MediaSegment[] = transcript.segments.map((segment, index) => ({
      id: hashId('seg', [videoId, String(index)]),
      locator: {
        kind: 'timecode' as const,
        startSec: segment.start,
        endSec: segment.start + segment.duration,
        ...(segment.speaker ? { speaker: segment.speaker } : {}),
      },
      text: segment.text,
      ...(segment.speaker ? { label: segment.speaker } : {}),
    }));

    return {
      ok: true,
      value: {
        segments,
        warnings: [],
      },
    };
  }
}
