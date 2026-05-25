// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { createHash } from 'node:crypto';
import type {
  Chunk,
  ChunkInput,
  DecodeInput,
  DecodeOutput,
  ExtractionContext,
  IContextProvider,
  IDecodeStrategy,
  IIngestor,
  IChunker,
  IngestInput,
  MediaSegment,
  RawSource,
  Result,
} from '@aidha/praecis-core';
import { composeVector, normalizeText } from '@aidha/praecis-core';
import type { ResolvedConfig, SourceRegistration } from '@aidha/config';

export interface LinkedInPastePayload {
  readonly pasteText: string;
  readonly url?: string;
  readonly activityUrn?: string;
}

export interface LinkedInVectorOptions {
  readonly pasteText: string;
  readonly url?: string;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function clean(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function activityUrnFromUrl(url?: string): string | undefined {
  const cleaned = clean(url);
  if (!cleaned) return undefined;
  const match = cleaned.match(/urn:li:activity:[A-Za-z0-9_-]+/);
  return match?.[0];
}

function canonicalIdFor(pasteText: string, url?: string): string {
  const activityUrn = activityUrnFromUrl(url);
  if (activityUrn) {
    return `linkedin:${activityUrn}`;
  }
  return `linkedin:${sha256Hex(normalizeText(pasteText))}`;
}

function sourceUriFor(url?: string): string {
  return clean(url) ?? 'stdin';
}

function splitPasteText(pasteText: string): Array<{ readonly text: string; readonly charStart: number; readonly charEnd: number }> {
  const normalized = pasteText.replace(/\r\n/g, '\n');
  const blocks = normalized.split(/\n{2,}/);
  const segments: Array<{ readonly text: string; readonly charStart: number; readonly charEnd: number }> = [];
  let cursor = 0;

  for (const block of blocks) {
    if (!block) continue;
    const start = normalized.indexOf(block, cursor);
    if (start < 0) continue;
    const trimmed = block.trim();
    if (!trimmed) {
      cursor = start + block.length;
      continue;
    }
    const leading = block.length - block.trimStart().length;
    const trailing = block.length - block.trimEnd().length;
    const charStart = start + leading;
    const charEnd = start + block.length - trailing;
    segments.push({ text: trimmed, charStart, charEnd });
    cursor = start + block.length;
  }

  return segments.length > 0 ? segments : [{ text: normalized.trim(), charStart: 0, charEnd: normalized.trim().length }];
}

function stableSegmentId(canonicalId: string, start: number, end: number): string {
  return sha256Hex(`${canonicalId}:${start}:${end}`).slice(0, 16);
}

function segmentLabel(text: string): string {
  return normalizeText(text.split('\n', 1)[0] ?? '').slice(0, 120);
}

class LinkedInHighlightChunker implements IChunker {
  readonly name = 'highlight';

  async chunk(input: ChunkInput): Promise<Result<Chunk[]>> {
    return {
      ok: true,
      value: input.segments.map(segment => ({
        id: segment.id,
        segments: [segment],
        text: segment.text?.trim() ?? '',
        locator: segment.locator,
      })),
    };
  }
}

class LinkedInContextProvider implements IContextProvider {
  constructor(private readonly options: LinkedInVectorOptions) {}

  async build(_raw: RawSource, _config: ResolvedConfig): Promise<ExtractionContext> {
    const summary = normalizeText(this.options.pasteText).slice(0, 240);
    return {
      sourceSummary: summary || undefined,
      chunkingHints: ['highlight'],
    };
  }
}

class LinkedInIngestor implements IIngestor<LinkedInPastePayload> {
  readonly sourceId = 'linkedin';

  constructor(private readonly options: LinkedInVectorOptions) {}

  async acquire(input: IngestInput): Promise<Result<RawSource & { payload: LinkedInPastePayload }>> {
    const canonicalId = canonicalIdFor(this.options.pasteText, this.options.url);
    const activityUrn = activityUrnFromUrl(this.options.url);
    const url = clean(this.options.url);
    const segments = splitPasteText(this.options.pasteText);

    return {
      ok: true,
      value: {
        canonicalId,
        dedupKeys: [
          canonicalId,
          ...(activityUrn ? [activityUrn] : []),
          ...(url ? [url] : []),
          `linkedin:${sha256Hex(normalizeText(this.options.pasteText))}`,
          input.ref,
        ],
        sourceType: 'linkedin',
        sensitivity: 'personal',
        provenance: {
          sourceUri: sourceUriFor(this.options.url),
          ingestedAt: new Date().toISOString(),
          sourceType: 'linkedin',
        },
        resourceMetadata: {
          ...(activityUrn ? { activityUrn } : {}),
          ...(url ? { url } : {}),
          paragraphCount: segments.length,
          contentHash: sha256Hex(normalizeText(this.options.pasteText)),
        },
        payload: {
          pasteText: this.options.pasteText,
          url: this.options.url,
          activityUrn,
        },
        label: 'LinkedIn paste',
      },
    };
  }
}

class LinkedInPassthroughDecodeStrategy implements IDecodeStrategy {
  readonly name = 'passthrough:linkedin';

  constructor(private readonly options: LinkedInVectorOptions) {}

  async decode(input: DecodeInput): Promise<Result<DecodeOutput>> {
    if (input.raw.sourceType !== 'linkedin') {
      return { ok: false, error: new Error(`LinkedIn decode expected sourceType=linkedin, got ${input.raw.sourceType}`) };
    }
    const payload = input.raw.payload as LinkedInPastePayload | undefined;
    if (!payload || payload.pasteText !== this.options.pasteText) {
      return { ok: false, error: new Error('LinkedIn decode expected matching pasted text payload') };
    }

    const canonicalId = input.raw.canonicalId;
    const segments = splitPasteText(this.options.pasteText).map((segment, index) => ({
      id: stableSegmentId(canonicalId, segment.charStart, segment.charEnd),
      locator: {
        kind: 'text' as const,
        charStart: segment.charStart,
        charEnd: segment.charEnd,
      },
      text: segment.text,
      label: segmentLabel(segment.text),
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

export const LinkedInSourceRegistration: SourceRegistration = {
  sourceId: 'linkedin',
  validateActiveSourceConfig: (value: unknown) => value,
};

export function createLinkedInVectorSpec(options: LinkedInVectorOptions) {
  return composeVector({
    sourceId: 'linkedin',
    sensitivity: 'personal',
    ingestor: new LinkedInIngestor(options),
    decode: [new LinkedInPassthroughDecodeStrategy(options)],
    context: new LinkedInContextProvider(options),
    chunking: new LinkedInHighlightChunker(),
    registration: LinkedInSourceRegistration,
  });
}
