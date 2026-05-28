// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import type { AudioRef, ITranscriber, TimecodedSegment, TranscribeOptions } from '@aidha/praecis-core';
import type { Result } from '@aidha/praecis-core';

export type { AudioRef, ITranscriber, TimecodedSegment, TranscribeOptions };

export type TranscriptBackendName =
  | 'openai'
  | 'groq'
  | 'assemblyai'
  | 'voxtral'
  | 'nvidia'
  | 'qwen'
  | 'local'
  | 'mock';

export interface TranscribePayload {
  readonly audio: AudioRef;
  readonly options?: TranscribeOptions;
  readonly transcriptText?: string;
  readonly segments?: readonly TimecodedSegment[];
}

export interface MockTranscriberConfig {
  readonly backend?: string;
  readonly segments?: readonly TimecodedSegment[];
  readonly transcriptText?: string;
}

function stableSegmentsFromText(text: string): TimecodedSegment[] {
  const words = text.split(/\s+/).map(token => token.trim()).filter(Boolean);
  if (words.length === 0) {
    return [];
  }

  const segmentCount = Math.max(1, Math.ceil(words.length / 12));
  const chunkSize = Math.ceil(words.length / segmentCount);
  const segments: TimecodedSegment[] = [];
  let index = 0;

  for (let i = 0; i < words.length; i += chunkSize) {
    const chunk = words.slice(i, i + chunkSize);
    const startSec = index * 10;
    const endSec = startSec + Math.max(5, chunk.length * 2);
    segments.push({
      id: `mock-seg-${index}`,
      startSec,
      endSec,
      text: chunk.join(' '),
    });
    index += 1;
  }

  return segments;
}

function trimSilenceEdges(segments: readonly TimecodedSegment[]): TimecodedSegment[] {
  let start = 0;
  let end = segments.length;

  while (start < end && segments[start]!.text.trim().length === 0) {
    start += 1;
  }
  while (end > start && segments[end - 1]!.text.trim().length === 0) {
    end -= 1;
  }

  return segments.slice(start, end).map((segment, index) => ({
    ...segment,
    id: segment.id || `trimmed-${index}`,
  }));
}

export function normalizeTranscriptionSegments(segments: readonly TimecodedSegment[]): TimecodedSegment[] {
  return trimSilenceEdges(segments).map(segment => ({
    ...segment,
    text: segment.text.trim(),
  }));
}

export class MockTranscriber implements ITranscriber {
  readonly backend: string;

  constructor(private readonly config: MockTranscriberConfig = {}) {
    this.backend = config.backend ?? 'mock';
  }

  async transcribe(audio: AudioRef, _opts: TranscribeOptions): Promise<Result<TimecodedSegment[]>> {
    const explicitSegments = this.config.segments?.length ? this.config.segments : undefined;
    const text = this.config.transcriptText ?? audio.uri;

    const segments = normalizeTranscriptionSegments(
      explicitSegments ?? stableSegmentsFromText(text),
    );

    return { ok: true, value: segments };
  }
}
