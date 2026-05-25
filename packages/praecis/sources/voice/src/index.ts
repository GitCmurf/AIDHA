// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { ResolvedConfig, SourceRegistration } from '@aidha/config';
import { composeVector, transcribeStrategy } from '@aidha/praecis-core';
import type {
  AudioRef,
  ExtractionContext,
  IContextProvider,
  IIngestor,
  IngestInput,
  RawSource,
  Result,
} from '@aidha/praecis-core';
import { MockTranscriber, type MockTranscriberConfig } from '@aidha/praecis-decode-transcribe';
import type { ITranscriber } from '@aidha/praecis-core';

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function guessMimeType(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.m4a') || lower.endsWith('.mp4')) return 'audio/mp4';
  if (lower.endsWith('.aac')) return 'audio/aac';
  if (lower.endsWith('.ogg') || lower.endsWith('.oga')) return 'audio/ogg';
  return 'audio/mpeg';
}

function normalizeBytes(value: Uint8Array | ArrayBuffer): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

class VoiceContextProvider implements IContextProvider {
  async build(raw: RawSource, _config: ResolvedConfig): Promise<ExtractionContext> {
    return {
      sourceSummary: raw.label,
      chunkingHints: ['conversation'],
    };
  }
}

export interface VoiceIngestorOptions {
  readonly readFileFn?: typeof readFile;
}

export class VoiceIngestor implements IIngestor<AudioRef> {
  readonly sourceId = 'voice';

  constructor(private readonly options: VoiceIngestorOptions = {}) {}

  async acquire(input: IngestInput): Promise<Result<RawSource & { payload: AudioRef }>> {
    try {
      const fileBytes = await (this.options.readFileFn ?? readFile)(input.ref);
      const bytes = normalizeBytes(fileBytes as Uint8Array | ArrayBuffer);
      const sha256 = sha256Hex(bytes);
      const audio: AudioRef = {
        uri: `voice:${sha256}`,
        mimeType: guessMimeType(input.ref),
      };
      const label = basename(input.ref) || input.ref;

      return {
        ok: true,
        value: {
          canonicalId: `voice:${sha256}`,
          dedupKeys: [`content-sha256:${sha256}`, input.ref],
          sourceType: 'voice',
          sensitivity: 'personal',
          provenance: {
            sourceUri: input.ref,
            ingestedAt: new Date().toISOString(),
            sourceType: 'voice',
          },
          resourceMetadata: {
            title: label,
            filePath: input.ref,
            sha256,
            mimeType: audio.mimeType,
          },
          payload: audio,
          label,
        },
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }
}

export const VoiceSourceRegistration: SourceRegistration = {
  sourceId: 'voice',
  validateActiveSourceConfig: (value: unknown) => value,
};

export function createVoiceVectorSpec(options: {
  readonly readFileFn?: typeof readFile;
  readonly transcriber?: ITranscriber;
  readonly mockTranscriber?: MockTranscriberConfig;
} = {}) {
  const transcriber =
    options.transcriber ??
    new MockTranscriber(options.mockTranscriber ?? {});

  return composeVector({
    sourceId: 'voice',
    sensitivity: 'personal',
    ingestor: new VoiceIngestor({ readFileFn: options.readFileFn }),
    decode: [transcribeStrategy(transcriber)],
    context: new VoiceContextProvider(),
    chunking: 'token-window',
    registration: VoiceSourceRegistration,
  });
}
