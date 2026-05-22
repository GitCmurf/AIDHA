// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type {
  Result,
  IIngestor,
  IDecodeStrategy,
  IContextProvider,
  IngestInput,
  DecodeInput,
  DecodeOutput,
  RawSource,
  ExtractionContext,
  MediaSegment,
} from '@aidha/praecis-core';
import { extractTextFromPdfText } from '@aidha/praecis-decode-text';
import { ocrBlocksToResult, type OcrBlock } from '@aidha/praecis-decode-ocr';
import type { ResolvedConfig, SourceRegistration } from '@aidha/config';

export interface PdfPagePayload {
  readonly pageNumber: number;
  readonly text?: string;
  readonly ocrBlocks?: readonly OcrBlock[];
}

export interface PdfDocumentPayload {
  readonly filePath: string;
  readonly title: string;
  readonly sha256: string;
  readonly pages: readonly PdfPagePayload[];
}

export interface PdfIngestorOptions {
  readonly readFileFn?: typeof readFile;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function utf8TextFromBytes(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

function splitPages(text: string): string[] {
  return text.split(/\f/g).map(page => page.replace(/\r/g, '').trim());
}

function pageSegmentsFromText(payload: PdfDocumentPayload): MediaSegment[] {
  const segments: MediaSegment[] = [];

  for (const page of payload.pages) {
    if (typeof page.text !== 'string' || page.text.trim().length === 0) {
      continue;
    }
    const normalized = extractTextFromPdfText(page.text).text || page.text.replace(/\s+/g, ' ').trim();
    segments.push({
      id: `pdf-page-${page.pageNumber}`,
      locator: { kind: 'page', page: page.pageNumber, charStart: 0, charEnd: normalized.length },
      text: normalized,
      label: `Page ${page.pageNumber}`,
    });
  }

  return segments;
}

function pagesWithoutText(payload: PdfDocumentPayload, upstream: readonly MediaSegment[] | undefined): PdfPagePayload[] {
  const coveredPages = new Set<number>();
  for (const segment of upstream ?? []) {
    if (segment.locator.kind === 'page') {
      coveredPages.add(segment.locator.page);
    }
  }
  return payload.pages.filter(page => !coveredPages.has(page.pageNumber));
}

function pageSegmentsFromOcr(payload: PdfDocumentPayload, upstream: readonly MediaSegment[] | undefined): MediaSegment[] {
  const pages = pagesWithoutText(payload, upstream);
  const segments: MediaSegment[] = [];

  for (const page of pages) {
    if (!page.ocrBlocks || page.ocrBlocks.length === 0) {
      continue;
    }
    const ocrResult = ocrBlocksToResult(page.ocrBlocks, `${payload.title} page ${page.pageNumber}`);
    for (const segment of ocrResult.segments) {
      const loc = segment.locator;
      if (loc.kind !== 'text') {
        continue;
      }
      segments.push({
        ...segment,
        id: `pdf-ocr-${page.pageNumber}-${segment.id}`,
        locator: { kind: 'page', page: page.pageNumber, charStart: loc.charStart, charEnd: loc.charEnd },
        label: `Page ${page.pageNumber}`,
      });
    }
  }

  return segments;
}

class NoOpContextProvider implements IContextProvider {
  async build(_raw: RawSource, _config: ResolvedConfig): Promise<ExtractionContext> {
    return {};
  }
}

export class PdfIngestor implements IIngestor<PdfDocumentPayload> {
  readonly sourceId = 'pdf';

  constructor(private readonly options: PdfIngestorOptions = {}) {}

  async acquire(input: IngestInput): Promise<Result<RawSource & { payload: PdfDocumentPayload }>> {
    try {
      const fileBytes = await (this.options.readFileFn ?? readFile)(input.ref);
      const bytes = fileBytes instanceof Uint8Array ? fileBytes : new Uint8Array(fileBytes as ArrayBuffer);
      const sha256 = sha256Hex(bytes);
      const title = basename(input.ref);
      const rawText = utf8TextFromBytes(bytes);
      const pages = splitPages(rawText).map((text, index) => ({ pageNumber: index + 1, text }));

      const payload: PdfDocumentPayload = {
        filePath: input.ref,
        title,
        sha256,
        pages,
      };

      return {
        ok: true,
        value: {
          canonicalId: `pdf:${sha256}`,
          dedupKeys: [sha256, input.ref],
          sourceType: 'pdf',
          sensitivity: 'personal',
          provenance: {
            sourceUri: input.ref,
            ingestedAt: new Date().toISOString(),
            sourceType: 'pdf',
          },
          payload,
          label: title,
        },
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }
}

export class PdfTextDecodeStrategy implements IDecodeStrategy {
  readonly name = 'text-extract:pdf';

  async decode(input: DecodeInput): Promise<Result<DecodeOutput>> {
    if (input.raw.sourceType !== 'pdf') {
      return { ok: false, error: new Error(`PdfTextDecodeStrategy expected sourceType=pdf, got ${input.raw.sourceType}`) };
    }
    const payload = input.raw.payload as PdfDocumentPayload | undefined;
    if (!payload) {
      return { ok: false, error: new Error('PdfTextDecodeStrategy expected PdfDocumentPayload') };
    }

    const segments = pageSegmentsFromText(payload);
    return {
      ok: true,
      value: {
        segments,
        warnings: segments.length > 0 ? [] : [{ unit: 'pdf', reason: 'no text layer detected' }],
      },
    };
  }
}

export class PdfOcrDecodeStrategy implements IDecodeStrategy {
  readonly name = 'ocr:pdf';

  async decode(input: DecodeInput): Promise<Result<DecodeOutput>> {
    if (input.raw.sourceType !== 'pdf') {
      return { ok: false, error: new Error(`PdfOcrDecodeStrategy expected sourceType=pdf, got ${input.raw.sourceType}`) };
    }
    const payload = input.raw.payload as PdfDocumentPayload | undefined;
    if (!payload) {
      return { ok: false, error: new Error('PdfOcrDecodeStrategy expected PdfDocumentPayload') };
    }

    const segments = [...(input.upstream ?? []), ...pageSegmentsFromOcr(payload, input.upstream)];
    return {
      ok: true,
      value: {
        segments,
        warnings: segments.length > 0 ? [] : [{ unit: 'pdf', reason: 'no OCR blocks provided' }],
      },
    };
  }
}

export const PdfSourceRegistration: SourceRegistration = {
  sourceId: 'pdf',
  validateActiveSourceConfig: (value: unknown) => value,
};

export function createPdfVectorSpec(readFileFn?: typeof readFile) {
  return {
    sourceId: 'pdf',
    sensitivity: 'personal' as const,
    ingestor: new PdfIngestor({ readFileFn }),
    decode: [new PdfTextDecodeStrategy(), new PdfOcrDecodeStrategy()],
    context: new NoOpContextProvider(),
    chunking: 'section' as const,
    registration: PdfSourceRegistration,
  };
}
