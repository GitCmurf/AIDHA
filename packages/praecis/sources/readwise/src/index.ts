// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { createHash } from 'node:crypto';
import type {
  Chunk,
  ChunkInput,
  DecodeInput,
  DecodeOutput,
  ExtractionContext,
  IChunker,
  IContextProvider,
  IDecodeStrategy,
  IIngestor,
  IngestInput,
  MediaSegment,
  RawSource,
  Result,
  ComposedVector,
  VectorRuntimeContext,
} from '@aidha/praecis-core';
import { composeVector, createRawSource, emptySourceConfigRegistration, urlCanonical } from '@aidha/praecis-core';
import type { ResolvedConfig } from '@aidha/config';

export interface ReadwiseHighlight {
  readonly id: number;
  readonly text: string;
  readonly book_id: number;
  readonly title?: string;
  readonly author?: string;
  readonly source_url?: string | null;
  readonly category?: string;
  readonly note?: string | null;
  readonly location?: number | null;
  readonly location_type?: string | null;
  readonly highlighted_at?: string | null;
  readonly updated_at?: string | null;
  readonly external_id?: string | null;
  readonly tags?: readonly string[];
  readonly readwise_url?: string | null;
}

export interface ReadwiseBook {
  readonly user_book_id: number;
  readonly title: string;
  readonly author?: string | null;
  readonly category?: string | null;
  readonly source?: string | null;
  readonly source_url?: string | null;
  readonly readable_title?: string | null;
  readonly book_tags?: readonly string[];
  readonly summary?: string | null;
  readonly document_note?: string | null;
  readonly readwise_url?: string | null;
  readonly external_id?: string | null;
  readonly highlights: readonly ReadwiseHighlight[];
}

export interface ReadwiseExportResponse {
  readonly count?: number;
  readonly nextPageCursor?: string | null;
  readonly results: readonly ReadwiseBook[];
}

export type ReadwiseFetchFn = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface ReadwiseExportOptions {
  readonly token: string;
  readonly fetchFn?: ReadwiseFetchFn;
  readonly updatedAfter?: string;
  readonly includeDeleted?: boolean;
  readonly ids?: readonly number[];
}

export interface ReadwiseVectorOptions {
  readonly book: ReadwiseBook;
}

export interface ReadwiseHighlightPayload {
  readonly book: ReadwiseBook;
  readonly canonicalId: string;
  readonly dedupKey: string;
}

export interface ReadwiseBatchResult {
  readonly updatedAfter?: string;
  readonly totalBooks: number;
  readonly summaries: readonly ReadwiseIngestSummary[];
}

export interface ReadwiseIngestSummary {
  readonly sourceId: string;
  readonly ref: string;
  readonly canonicalId: string;
  readonly label?: string;
  readonly segmentCount: number;
  readonly chunkCount: number;
  readonly warnings: readonly string[];
  readonly segments: readonly ReadwiseSegmentSummary[];
  readonly chunks: readonly ReadwiseChunkSummary[];
}

export interface ReadwiseSegmentSummary {
  readonly id: string;
  readonly locator: { kind: 'external'; system: string; externalId: string };
  readonly text?: string;
  readonly label?: string;
}

export interface ReadwiseChunkSummary {
  readonly id: string;
  readonly locator: { kind: 'external'; system: string; externalId: string };
  readonly text: string;
  readonly segmentIds: readonly string[];
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableId(seed: string): string {
  return sha256Hex(seed).slice(0, 16);
}

function clean(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function bookKey(book: ReadwiseBook): string {
  return clean(book.source_url) ? `web:${urlCanonical(book.source_url!)}` : `readwise:book:${book.user_book_id}`;
}

function bookSourceUri(book: ReadwiseBook): string | undefined {
  return clean(book.source_url) ?? clean(book.readwise_url) ?? clean(book.external_id) ?? undefined;
}

function sourceSummary(book: ReadwiseBook): string {
  return [book.title, book.author ?? '', book.category ?? '']
    .map(value => value.trim())
    .filter(Boolean)
    .join(' — ');
}

function highlightText(highlight: ReadwiseHighlight): string {
  return highlight.text.trim() || highlight.note?.trim() || '';
}

function toHighlightSegments(book: ReadwiseBook): MediaSegment[] {
  return book.highlights.map(highlight => {
    const externalId = String(highlight.id);
    return {
      id: stableId(`${bookKey(book)}:${externalId}`),
      locator: { kind: 'external' as const, system: 'readwise', externalId },
      text: highlightText(highlight),
      label: highlight.note?.trim() || book.title,
    };
  });
}

class ReadwiseContextProvider implements IContextProvider<ReadwiseHighlightPayload> {
  constructor(private readonly book: ReadwiseBook) {}

  async build(_raw: RawSource<ReadwiseHighlightPayload>, _config: ResolvedConfig): Promise<ExtractionContext> {
    return {
      sourceSummary: sourceSummary(this.book),
      topicsOfInterest: clean(this.book.category) ? [clean(this.book.category)!] : undefined,
      chunkingHints: ['highlight'],
    };
  }
}

class ReadwiseHighlightDecodeStrategy implements IDecodeStrategy<ReadwiseHighlightPayload> {
  readonly name = 'passthrough:readwise';

  constructor(private readonly book: ReadwiseBook) {}

  async decode(input: DecodeInput<ReadwiseHighlightPayload>): Promise<Result<DecodeOutput>> {
    if (input.raw.sourceType !== 'readwise') {
      return { ok: false, error: new Error(`Readwise decode expected sourceType=readwise, got ${input.raw.sourceType}`) };
    }
    const payload = input.raw.payload;
    if (!payload || payload.canonicalId !== bookKey(this.book)) {
      return { ok: false, error: new Error('Readwise decode expected matching book payload') };
    }

    return {
      ok: true,
      value: {
        segments: toHighlightSegments(this.book),
        warnings: [],
      },
    };
  }
}

class ReadwiseHighlightChunker implements IChunker {
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

export class ReadwiseIngestor implements IIngestor<ReadwiseHighlightPayload> {
  readonly sourceId = 'readwise';

  constructor(private readonly options: ReadwiseVectorOptions) {}

  async acquire(input: IngestInput, runtimeContext: VectorRuntimeContext): Promise<Result<RawSource<ReadwiseHighlightPayload>>> {
    const canonicalId = bookKey(this.options.book);
    return {
      ok: true,
      value: createRawSource({
        canonicalId,
        dedupKeys: [
          canonicalId,
          `readwise:book:${this.options.book.user_book_id}`,
          ...(clean(this.options.book.source_url) ? [urlCanonical(this.options.book.source_url!)] : []),
          ...(clean(this.options.book.readwise_url) ? [this.options.book.readwise_url!] : []),
          input.ref,
        ],
        sourceType: 'readwise',
        sensitivity: 'personal',
        sourceUri: bookSourceUri(this.options.book),
        clock: runtimeContext.clock,
        resourceMetadata: {
          title: this.options.book.title,
          ...(clean(this.options.book.author) ? { author: clean(this.options.book.author) } : {}),
          ...(clean(this.options.book.category) ? { category: clean(this.options.book.category) } : {}),
          ...(clean(this.options.book.source_url) ? { canonicalUrl: urlCanonical(this.options.book.source_url!), sourceUrl: this.options.book.source_url } : {}),
          ...(clean(this.options.book.readwise_url) ? { readwiseUrl: this.options.book.readwise_url } : {}),
          readwiseBookId: this.options.book.user_book_id,
          highlightCount: this.options.book.highlights.length,
        },
        payload: {
          book: this.options.book,
          canonicalId,
          dedupKey: `readwise:book:${this.options.book.user_book_id}`,
        },
        label: this.options.book.title,
      }),
    };
  }
}

export const ReadwiseSourceRegistration = emptySourceConfigRegistration('readwise');

export interface ReadwiseVectorSpecOptions {
  readonly book: ReadwiseBook;
}

export function createReadwiseVectorSpec(options: ReadwiseVectorSpecOptions): ComposedVector<ReadwiseHighlightPayload> {
  const { book } = options;
  return composeVector({
    sourceId: 'readwise',
    sensitivity: 'personal',
    ingestor: new ReadwiseIngestor({ book }),
    decode: [new ReadwiseHighlightDecodeStrategy(book)],
    context: new ReadwiseContextProvider(book),
    chunking: new ReadwiseHighlightChunker(),
    registration: ReadwiseSourceRegistration,
  });
}

export function buildReadwiseBookSummary(book: ReadwiseBook): { readonly sourceId: string; readonly ref: string; readonly canonicalId: string } {
  const canonicalId = bookKey(book);
  return {
    sourceId: 'readwise',
    ref: clean(book.readwise_url) ?? canonicalId,
    canonicalId,
  };
}

export async function fetchReadwiseExport(options: ReadwiseExportOptions): Promise<ReadwiseBook[]> {
  const fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
  const results: ReadwiseBook[] = [];
  let nextPageCursor: string | undefined;

  while (true) {
    const query = new URLSearchParams();
    if (options.updatedAfter) query.set('updatedAfter', options.updatedAfter);
    if (nextPageCursor) query.set('pageCursor', nextPageCursor);
    if (options.includeDeleted) query.set('includeDeleted', 'true');
    if (options.ids && options.ids.length > 0) query.set('ids', options.ids.join(','));

    const url = `https://readwise.io/api/v2/export/?${query.toString()}`;
    const response = await fetchFn(url, {
      headers: {
        Authorization: `Token ${options.token}`,
      },
    });
    if (!response.ok) {
      throw new Error(`readwise export failed: HTTP ${response.status}`);
    }

    const payload = (await response.json()) as ReadwiseExportResponse;
    results.push(...payload.results);
    nextPageCursor = payload.nextPageCursor ?? undefined;
    if (!nextPageCursor) break;
  }

  return results;
}

export async function runReadwiseBatch(options: ReadwiseExportOptions): Promise<ReadwiseBatchResult> {
  const books = await fetchReadwiseExport(options);
  const summaries = books.map(book => {
    const vector = createReadwiseVectorSpec({ book });
    return {
      sourceId: vector.sourceId,
      ref: clean(book.readwise_url) ?? buildReadwiseBookSummary(book).ref,
      canonicalId: bookKey(book),
      label: book.title,
      segmentCount: book.highlights.length,
      chunkCount: book.highlights.length,
      warnings: [],
      segments: toHighlightSegments(book).map(segment => ({
        id: segment.id,
        locator: segment.locator as { kind: 'external'; system: string; externalId: string },
        text: segment.text,
        label: segment.label,
      })),
      chunks: toHighlightSegments(book).map(segment => ({
        id: segment.id,
        locator: segment.locator as { kind: 'external'; system: string; externalId: string },
        text: segment.text?.trim() ?? '',
        segmentIds: [segment.id],
      })),
    };
  });

  return {
    updatedAfter: options.updatedAfter,
    totalBooks: books.length,
    summaries,
  };
}
