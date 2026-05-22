// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { ResolvedConfig, SourceRegistration } from '@aidha/config';
import { composeVector, diarizeStrategy, transcribeStrategy } from '@aidha/praecis-core';
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
import { MockDiarizer, type MockDiarizerConfig } from '@aidha/praecis-decode-diarize';
import type { ITranscriber, IDiarizer } from '@aidha/praecis-core';

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

class MeetingContextProvider implements IContextProvider {
  async build(raw: RawSource, _config: ResolvedConfig): Promise<ExtractionContext> {
    return {
      sourceSummary: raw.label,
      chunkingHints: ['conversation'],
    };
  }
}

export interface MeetingIngestorOptions {
  readonly readFileFn?: typeof readFile;
}

export class MeetingIngestor implements IIngestor<AudioRef> {
  readonly sourceId = 'meeting';

  constructor(private readonly options: MeetingIngestorOptions = {}) {}

  async acquire(input: IngestInput): Promise<Result<RawSource & { payload: AudioRef }>> {
    try {
      const fileBytes = await (this.options.readFileFn ?? readFile)(input.ref);
      const bytes = normalizeBytes(fileBytes as Uint8Array | ArrayBuffer);
      const sha256 = sha256Hex(bytes);
      const audio: AudioRef = {
        uri: `meeting:${sha256}`,
        mimeType: guessMimeType(input.ref),
      };

      return {
        ok: true,
        value: {
          canonicalId: `meeting:${sha256}`,
          dedupKeys: [`content-sha256:${sha256}`, input.ref],
          sourceType: 'meeting',
          sensitivity: 'confidential',
          provenance: {
            sourceUri: input.ref,
            ingestedAt: new Date().toISOString(),
            sourceType: 'meeting',
          },
          payload: audio,
          label: input.ref.split('/').pop() ?? input.ref,
        },
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }
}

export const MeetingSourceRegistration: SourceRegistration = {
  sourceId: 'meeting',
  validateActiveSourceConfig: (value: unknown) => value,
};

export function createMeetingVectorSpec(options: {
  readonly readFileFn?: typeof readFile;
  readonly transcriber?: ITranscriber;
  readonly diarizer?: IDiarizer;
  readonly mockTranscriber?: MockTranscriberConfig;
  readonly mockDiarizer?: MockDiarizerConfig;
} = {}) {
  const transcriber =
    options.transcriber ??
    new MockTranscriber(options.mockTranscriber ?? { transcriptText: 'meeting transcript sample' });
  const diarizer =
    options.diarizer ??
    new MockDiarizer(options.mockDiarizer ?? {});

  return composeVector({
    sourceId: 'meeting',
    sensitivity: 'confidential',
    ingestor: new MeetingIngestor({ readFileFn: options.readFileFn }),
    decode: [transcribeStrategy(transcriber), diarizeStrategy(diarizer)],
    context: new MeetingContextProvider(),
    chunking: 'conversation',
    registration: MeetingSourceRegistration,
  });
}
