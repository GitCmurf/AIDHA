// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import type { MediaSegment } from '../types/index.js';
import type { ExtractionContext } from '../types/index.js';
import type { RawSource } from '../types/index.js';
import type { DecodeOutput } from '../types/index.js';
import type { Locator } from '../types/index.js';
import type { Result } from '@aidha/taxonomy';
import type { ResolvedConfig } from '@aidha/config';
import type { GraphStore } from '@aidha/graph-backend';

export type { MediaSegment, ExtractionContext, RawSource, DecodeOutput, Locator };

export interface IngestInput {
  readonly ref: string;
  readonly metadata?: Record<string, unknown>;
}

export interface AudioRef {
  readonly uri: string;
  readonly mimeType: string;
}

export interface TranscribeOptions {
  language?: string;
  maxTokens?: number;
}

export interface TimecodedSegment {
  id: string;
  startSec: number;
  endSec: number;
  text: string;
  speaker?: string;
}

export interface ChunkInput {
  readonly segments: readonly MediaSegment[];
  readonly context: ExtractionContext;
}

export interface Chunk {
  readonly id: string;
  readonly segments: readonly MediaSegment[];
  readonly text: string;
  readonly locator: Locator;
}

export interface WebFetchInput {
  readonly url: string;
  readonly options?: { followRedirects?: boolean };
}

export interface CostCeiling {
  readonly maxTokens?: number;
  readonly maxSpendUsd?: number;
}

export interface PrivacyPolicy {
  readonly allowCloudLlm: boolean;
  readonly sensitivityCeiling: 'public' | 'personal' | 'confidential';
}

export interface RunReport {
  readonly sourceId: string;
  readonly canonicalId: string;
  readonly claimsExtracted: number;
  readonly warnings: readonly string[];
  readonly durationMs: number;
}

export interface ILLMClient {
  complete(prompt: string, opts?: { maxTokens?: number }): Promise<Result<string>>;
}

export interface ICache {
  get(key: string): Promise<Result<string | null>>;
  set(key: string, value: string): Promise<Result<void>>;
}

export interface IIngestor<TPayload = unknown> {
  readonly sourceId: string;
  acquire(input: IngestInput): Promise<Result<RawSource & { payload: TPayload }>>;
}

export interface DecodeInput {
  readonly raw: RawSource;
  readonly upstream?: readonly MediaSegment[];
  readonly config: ResolvedConfig;
}

export interface IDecodeStrategy {
  readonly name: string;
  decode(input: DecodeInput): Promise<Result<DecodeOutput>>;
}

export interface IChunker {
  readonly name: string;
  chunk(input: ChunkInput): Promise<Result<Chunk[]>>;
}

export interface ICandidateMiner {
  mine(chunks: readonly Chunk[], context: ExtractionContext): Promise<Result<unknown>>;
}

export interface IEditor {
  edit(miningResult: unknown, context: ExtractionContext): Promise<Result<unknown>>;
}

export interface IExporter {
  export(editResult: unknown, raw: RawSource): Promise<Result<unknown>>;
}

export interface ITranscriber {
  readonly backend: string;
  transcribe(audio: AudioRef, opts: TranscribeOptions): Promise<Result<TimecodedSegment[]>>;
}

export interface IDiarizer {
  readonly backend: string;
  diarize(audio: AudioRef, segments: TimecodedSegment[]): Promise<Result<TimecodedSegment[]>>;
}

export interface IWebFetcher {
  readonly backend: string;
  fetch(input: WebFetchInput): Promise<Result<{ url: string; canonicalUrl: string; title: string; html: string }>>;
}

export interface IContextProvider {
  build(raw: RawSource, userConfig: ResolvedConfig): Promise<ExtractionContext>;
}

export interface PipelineServices {
  readonly store: GraphStore;
  readonly miner: ICandidateMiner;
  readonly editor: IEditor;
  readonly exporter: IExporter;
  readonly llm: ILLMClient;
  readonly cache: ICache;
  readonly costCeiling: CostCeiling;
  readonly privacy: PrivacyPolicy;
}

export interface PipelineRuntime {
  // ComposedVector is defined in compose/vector.ts. Using structural typing:
  // any object with at least { sourceId: string } satisfies the register call.
  // The concrete overload in runtime.ts narrows to ComposedVector.
  register(vector: { readonly sourceId: string }): void;
  run(sourceId: string, input: IngestInput): Promise<Result<RunReport>>;
}
