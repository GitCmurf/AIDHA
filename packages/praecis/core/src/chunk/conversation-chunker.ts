// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { createHash } from 'node:crypto';
import type { IChunker, ChunkInput, Chunk, MediaSegment, Locator } from '../interfaces/index.js';
import type { Result } from '@aidha/taxonomy';
import { normalizeText } from '../utils/index.js';

function chunkId(firstSegment: MediaSegment, index: number, speakerKey: string): string {
  return createHash('sha256')
    .update(`conversation:${index}:${firstSegment.id}:${speakerKey}`)
    .digest('hex')
    .slice(0, 16);
}

function conversationLocator(segments: readonly MediaSegment[]): Locator {
  const first = segments[0]!;
  const last = segments[segments.length - 1]!;
  if (first.locator.kind === 'timecode' && last.locator.kind === 'timecode') {
    return {
      kind: 'timecode',
      startSec: first.locator.startSec,
      endSec: last.locator.endSec,
      ...(first.locator.speaker || last.locator.speaker
        ? { speaker: first.locator.speaker ?? last.locator.speaker }
        : {}),
    };
  }
  return first.locator;
}

function speakerKey(segment: MediaSegment): string {
  const raw = segment.locator.kind === 'timecode' ? segment.locator.speaker ?? segment.label : segment.label;
  return normalizeText(raw ?? '') || 'speaker-unknown';
}

export class ConversationChunker implements IChunker {
  readonly name = 'conversation';

  async chunk(input: ChunkInput): Promise<Result<Chunk[]>> {
    if (input.segments.length === 0) {
      return { ok: true, value: [] };
    }

    const chunks: Chunk[] = [];
    let current: MediaSegment[] = [];
    let currentSpeakerKey: string | undefined;
    let index = 0;

    const flush = () => {
      if (current.length === 0) return;
      const key = currentSpeakerKey ?? 'speaker-unknown';
      chunks.push({
        id: chunkId(current[0]!, index++, key),
        segments: [...current],
        text: current.map(segment => segment.text ?? '').map(normalizeText).filter(Boolean).join(' ').trim(),
        locator: conversationLocator(current),
      });
      current = [];
      currentSpeakerKey = undefined;
    };

    for (const segment of input.segments) {
      const nextSpeakerKey = speakerKey(segment);
      if (current.length > 0 && currentSpeakerKey !== nextSpeakerKey) {
        flush();
      }
      currentSpeakerKey = nextSpeakerKey;
      current.push(segment);
    }

    flush();
    return { ok: true, value: chunks };
  }
}
