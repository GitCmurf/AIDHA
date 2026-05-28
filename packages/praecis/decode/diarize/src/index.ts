// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import type { IDiarizer, TimecodedSegment, AudioRef } from '@aidha/praecis-core';
import type { Result } from '@aidha/praecis-core';

export type { IDiarizer, TimecodedSegment, AudioRef };

export type DiarizationBackendName = 'assemblyai' | 'pyannote' | 'whisperx' | 'none' | 'mock';

export interface MockDiarizerConfig {
  readonly backend?: string;
  readonly speakerLabels?: readonly string[];
}

function speakerForIndex(index: number, labels: readonly string[]): string {
  return labels[index % labels.length] ?? `Speaker ${index + 1}`;
}

export function normalizeDiarizedSegments(segments: readonly TimecodedSegment[]): TimecodedSegment[] {
  return segments.map((segment, index) => ({
    ...segment,
    speaker: segment.speaker?.trim() || `Speaker ${index + 1}`,
  }));
}

export class MockDiarizer implements IDiarizer {
  readonly backend: string;

  constructor(private readonly config: MockDiarizerConfig = {}) {
    this.backend = config.backend ?? 'mock';
  }

  async diarize(_audio: AudioRef, segments: TimecodedSegment[]): Promise<Result<TimecodedSegment[]>> {
    const labels = this.config.speakerLabels?.length ? this.config.speakerLabels : ['Speaker 1', 'Speaker 2'];
    const diarized = segments.map((segment, index) => ({
      ...segment,
      speaker: segment.speaker?.trim() || speakerForIndex(index, labels),
    }));

    return { ok: true, value: normalizeDiarizedSegments(diarized) };
  }
}

export class NoOpDiarizer implements IDiarizer {
  readonly backend = 'none';

  async diarize(_audio: AudioRef, segments: TimecodedSegment[]): Promise<Result<TimecodedSegment[]>> {
    return { ok: true, value: normalizeDiarizedSegments(segments) };
  }
}
