// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import type {
  IIngestor,
  IDecodeStrategy,
  IContextProvider,
  IChunker,
  ITranscriber,
  IDiarizer,
  AudioRef,
  TranscribeOptions,
  TimecodedSegment,
  IngestInput,
  ChunkInput,
  Chunk,
} from '../interfaces/index.js';
import type { MediaSegment, RawSource, DecodeOutput } from '../types/index.js';
import type { DecodeWarning } from '../types/index.js';
import type { Result } from '@aidha/taxonomy';
import type { ResolvedConfig, SourceRegistration } from '@aidha/config';
import { TokenWindowChunker } from '../chunk/token-window-chunker.js';
import { SectionChunker } from '../chunk/section-chunker.js';

// ---------------------------------------------------------------------------
// DefaultChunker — fallback for unrecognized string names
// ---------------------------------------------------------------------------

class DefaultChunker implements IChunker {
  constructor(readonly name: string) {}

  async chunk(_input: ChunkInput): Promise<Result<Chunk[]>> {
    return {
      ok: false,
      error: new Error(`unknown chunker "${this.name}"`),
    };
  }
}

// ---------------------------------------------------------------------------
// VectorSpec + ComposedVector
// ---------------------------------------------------------------------------

export interface VectorSpec {
  readonly sourceId: string;
  readonly sensitivity: 'public' | 'personal' | 'confidential';
  readonly ingestor: IIngestor;
  readonly decode: IDecodeStrategy[];
  readonly context: IContextProvider;
  readonly chunking: IChunker | 'token-window' | 'section' | 'conversation' | 'highlight';
  readonly registration: SourceRegistration;
}

export interface ComposedVector {
  readonly sourceId: string;
  readonly sensitivity: VectorSpec['sensitivity'];
  readonly ingestor: IIngestor;
  readonly decode: readonly IDecodeStrategy[];
  readonly context: IContextProvider;
  readonly chunking: IChunker;
  readonly registration: SourceRegistration;
  ingestAndDecode(input: IngestInput): Promise<Result<{
    raw: RawSource;
    segments: MediaSegment[];
    warnings: DecodeWarning[];
  }>>;
}

// ---------------------------------------------------------------------------
// composeVector
// ---------------------------------------------------------------------------

export function composeVector(spec: VectorSpec): ComposedVector {
  if (spec.decode.length === 0) {
    throw new Error('VectorSpec.decode must have at least one strategy');
  }
  if (spec.sourceId !== spec.registration.sourceId) {
    throw new Error(
      `VectorSpec.sourceId "${spec.sourceId}" does not match registration.sourceId "${spec.registration.sourceId}"`
    );
  }

  const chunking: IChunker =
    typeof spec.chunking === 'string'
      ? spec.chunking === 'token-window' ? new TokenWindowChunker()
      : spec.chunking === 'section' ? new SectionChunker()
      : new DefaultChunker(spec.chunking)
    : spec.chunking;

  const frozenDecode = Object.freeze([...spec.decode]);

  async function ingestAndDecode(input: IngestInput): Promise<Result<{
    raw: RawSource;
    segments: MediaSegment[];
    warnings: DecodeWarning[];
  }>> {
    const acquireResult = await spec.ingestor.acquire(input);
    if (!acquireResult.ok) {
      return acquireResult;
    }

    const raw = acquireResult.value as RawSource;

    // Fold the decode chain, accumulating segments and warnings
    let currentSegments: readonly MediaSegment[] = [];
    const allWarnings: DecodeWarning[] = [];

    for (const strategy of frozenDecode) {
      const decodeResult = await strategy.decode({
        raw,
        upstream: currentSegments,
        config: {} as ResolvedConfig,
      });
      if (!decodeResult.ok) {
        return decodeResult;
      }
      currentSegments = decodeResult.value.segments;
      if (decodeResult.value.warnings) {
        allWarnings.push(...decodeResult.value.warnings);
      }
    }

    if (currentSegments.length === 0) {
      return {
        ok: false,
        error: new Error(`decode produced zero segments for ${raw.canonicalId}`),
      };
    }

    return {
      ok: true,
      value: {
        raw,
        segments: [...currentSegments],
        warnings: allWarnings,
      },
    };
  }

  return {
    sourceId: spec.sourceId,
    sensitivity: spec.sensitivity,
    ingestor: spec.ingestor,
    decode: frozenDecode,
    context: spec.context,
    chunking,
    registration: spec.registration,
    ingestAndDecode,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers for adapter functions
// ---------------------------------------------------------------------------

function audioRefFromPayload(payload: unknown): AudioRef {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    typeof (payload as Record<string, unknown>)['uri'] !== 'string' ||
    typeof (payload as Record<string, unknown>)['mimeType'] !== 'string'
  ) {
    throw new Error('invalid audio payload: expected { uri: string, mimeType: string }');
  }
  const p = payload as { uri: string; mimeType: string };
  return { uri: p['uri'], mimeType: p['mimeType'] };
}

function transcribeOptsFrom(_config: ResolvedConfig): TranscribeOptions {
  return {};
}

function timecodedToMediaSegments(segs: TimecodedSegment[]): MediaSegment[] {
  return segs.map(s => ({
    id: s.id,
    locator: {
      kind: 'timecode' as const,
      startSec: s.startSec,
      endSec: s.endSec,
      speaker: s.speaker,
    },
    text: s.text,
    label: s.speaker,
  }));
}

function mediaSegmentsToTimecoded(segs: readonly MediaSegment[]): TimecodedSegment[] {
  return segs.map(s => {
    if (s.locator.kind !== 'timecode') {
      throw new Error(
        `diarize strategy requires upstream timecode segments; got locator kind "${s.locator.kind}"`
      );
    }
    return {
      id: s.id,
      startSec: s.locator.startSec,
      endSec: s.locator.endSec,
      text: s.text ?? '',
      speaker: s.locator.speaker,
    };
  });
}

function mapResult<T, U>(result: Result<T>, fn: (value: T) => U): Result<U> {
  if (!result.ok) return result;
  return { ok: true, value: fn(result.value) };
}

// ---------------------------------------------------------------------------
// Adapter functions
// ---------------------------------------------------------------------------

export function transcribeStrategy(transcriber: ITranscriber): IDecodeStrategy {
  return {
    name: `transcribe:${transcriber.backend}`,
    async decode(input): Promise<Result<DecodeOutput>> {
      const audio = audioRefFromPayload(input.raw.payload);
      const opts = transcribeOptsFrom(input.config);
      const result = await transcriber.transcribe(audio, opts);
      return mapResult(result, segs => ({
        segments: timecodedToMediaSegments(segs),
        warnings: [],
      }));
    },
  };
}

export function diarizeStrategy(diarizer: IDiarizer): IDecodeStrategy {
  return {
    name: `diarize:${diarizer.backend}`,
    async decode(input): Promise<Result<DecodeOutput>> {
      if (!input.upstream || input.upstream.length === 0) {
        throw new Error('diarize strategy requires an upstream transcribe step');
      }
      const audio = audioRefFromPayload(input.raw.payload);
      const timecoded = mediaSegmentsToTimecoded(input.upstream);
      const result = await diarizer.diarize(audio, timecoded);
      return mapResult(result, segs => ({
        segments: timecodedToMediaSegments(segs),
        warnings: [],
      }));
    },
  };
}
