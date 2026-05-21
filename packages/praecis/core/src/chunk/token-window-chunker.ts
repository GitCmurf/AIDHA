// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { createHash } from 'node:crypto';
import type { IChunker, ChunkInput, Chunk, MediaSegment } from '../interfaces/index.js';
import type { Locator } from '../types/index.js';
import type { Result } from '@aidha/taxonomy';
import { estimateTokens } from '../extract/token-budget.js';

export interface TokenWindowConfig {
  readonly targetTokens?: number;
  readonly maxTokens?: number;
}

function spanLocator(segments: readonly MediaSegment[]): Locator {
  const first = segments[0]!;
  const last = segments[segments.length - 1]!;
  if (first.locator.kind === 'timecode' && last.locator.kind === 'timecode') {
    return { kind: 'timecode', startSec: first.locator.startSec, endSec: last.locator.endSec };
  }
  if (first.locator.kind === 'text' && last.locator.kind === 'text') {
    return { kind: 'text', charStart: first.locator.charStart, charEnd: last.locator.charEnd };
  }
  return first.locator;
}

function chunkId(firstSegId: string, index: number): string {
  return createHash('sha256')
    .update(`chunk:${index}:${firstSegId}`)
    .digest('hex')
    .slice(0, 16);
}

export class TokenWindowChunker implements IChunker {
  readonly name = 'token-window';
  private readonly targetTokens: number;
  private readonly maxTokens: number;

  constructor(config: TokenWindowConfig = {}) {
    this.targetTokens = config.targetTokens ?? 400;
    this.maxTokens = config.maxTokens ?? 600;
  }

  async chunk(input: ChunkInput): Promise<Result<Chunk[]>> {
    if (input.segments.length === 0) {
      return { ok: true, value: [] };
    }

    const chunks: Chunk[] = [];
    let window: MediaSegment[] = [];
    let windowTokens = 0;
    let chunkIndex = 0;

    const flush = () => {
      if (window.length === 0) return;
      const text = window.map(s => s.text ?? '').join(' ').trim();
      chunks.push({
        id: chunkId(window[0]!.id, chunkIndex++),
        segments: [...window],
        text,
        locator: spanLocator(window),
      });
      window = [];
      windowTokens = 0;
    };

    for (const seg of input.segments) {
      const segTokens = estimateTokens(seg.text ?? '');
      if (window.length > 0 && windowTokens + segTokens > this.maxTokens) {
        flush();
      }
      window.push(seg);
      windowTokens += segTokens;
      if (windowTokens >= this.targetTokens) {
        flush();
      }
    }
    flush();

    return { ok: true, value: chunks };
  }
}
