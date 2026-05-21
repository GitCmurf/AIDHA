// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import type { Result, IIngestor, IDecodeStrategy, IContextProvider, IngestInput, DecodeInput, DecodeOutput, RawSource, ExtractionContext } from '@aidha/praecis-core';
import { normalizeText, urlCanonical } from '@aidha/praecis-core';
import { HttpWebFetcher, type WebFetchFn } from '@aidha/praecis-acquire-webfetch';
import { extractTextFromHtml } from '@aidha/praecis-decode-text';
import type { SourceRegistration, ResolvedConfig } from '@aidha/config';
import { createHash } from 'node:crypto';

export interface WebPagePayload {
  readonly url: string;
  readonly canonicalUrl: string;
  readonly title: string;
  readonly html: string;
  readonly text: string;
}

export interface WebIngestorOptions {
  readonly fetchFn?: WebFetchFn;
}

export class WebIngestor implements IIngestor<WebPagePayload> {
  readonly sourceId = 'web';

  private readonly fetcher: HttpWebFetcher;

  constructor(options: WebIngestorOptions = {}) {
    this.fetcher = new HttpWebFetcher(options.fetchFn);
  }

  async acquire(input: IngestInput): Promise<Result<RawSource & { payload: WebPagePayload }>> {
    const fetchResult = await this.fetcher.fetch({ url: input.ref });
    if (!fetchResult.ok) return fetchResult;

    const { url, canonicalUrl, title, html } = fetchResult.value;
    const textResult = extractTextFromHtml(html, { sourceId: `web:${canonicalUrl}` });

    const payload: WebPagePayload = {
      url,
      canonicalUrl,
      title,
      html,
      text: textResult.text,
    };

    return {
      ok: true,
      value: {
        canonicalId: `web:${canonicalUrl}`,
        dedupKeys: Array.from(
          new Set([canonicalUrl, url, input.ref].filter((value): value is string => typeof value === 'string' && value.length > 0))
        ),
        sourceType: 'web',
        sensitivity: 'public',
        provenance: {
          sourceUri: url,
          ingestedAt: new Date().toISOString(),
          sourceType: 'web',
        },
        payload,
        label: title,
      },
    };
  }
}

export class WebTextDecodeStrategy implements IDecodeStrategy {
  readonly name = 'text-extract:web';

  async decode(input: DecodeInput): Promise<Result<DecodeOutput>> {
    if (input.raw.sourceType !== 'web') {
      return { ok: false, error: new Error(`WebTextDecodeStrategy expected sourceType=web, got ${input.raw.sourceType}`) };
    }

    const payload = input.raw.payload as WebPagePayload | undefined;
    if (!payload || typeof payload.html !== 'string') {
      return { ok: false, error: new Error('WebTextDecodeStrategy expected WebPagePayload with html') };
    }

    const extracted = extractTextFromHtml(payload.html, { sourceId: input.raw.canonicalId });
    return {
      ok: true,
      value: {
        segments: extracted.segments,
        warnings: [],
      },
    };
  }
}

class NoOpContextProvider implements IContextProvider {
  async build(_raw: RawSource, _config: ResolvedConfig): Promise<ExtractionContext> {
    return {};
  }
}

function stableId(source: string, raw: string): string {
  return createHash('sha256').update(`${source}:${raw}`).digest('hex').slice(0, 16);
}

export const WebSourceRegistration: SourceRegistration = {
  sourceId: 'web',
  validateActiveSourceConfig: (value: unknown) => value,
};

export function createWebVectorSpec(fetchFn?: WebFetchFn) {
  return {
    sourceId: 'web',
    sensitivity: 'public' as const,
    ingestor: new WebIngestor({ fetchFn }),
    decode: [new WebTextDecodeStrategy()],
    context: new NoOpContextProvider(),
    chunking: 'token-window' as const,
    registration: WebSourceRegistration,
  };
}

export function buildWebResourceId(url: string): string {
  return `web:${urlCanonical(url)}`;
}

export function buildWebContentId(canonicalUrl: string, title: string): string {
  return stableId(canonicalUrl, normalizeText(title));
}
