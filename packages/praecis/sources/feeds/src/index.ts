// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { createHash } from 'node:crypto';
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
  Clock,
} from '@aidha/praecis-core';
import { extractTextFromHtml } from '@aidha/praecis-decode-text';
import { HttpWebFetcher, type WebFetchFn } from '@aidha/praecis-acquire-webfetch';
import { urlCanonical } from '@aidha/praecis-core';
import type { ResolvedConfig, SourceRegistration } from '@aidha/config';

export interface RssItem {
  readonly guid?: string;
  readonly title: string;
  readonly link?: string;
  readonly description?: string;
  readonly contentHtml?: string;
  readonly categories: readonly string[];
  readonly publishedAt?: string;
}

export interface RssFeedPayload {
  readonly feedUrl: string;
  readonly feedTitle: string;
  readonly item: RssItem;
  readonly articleHtml: string;
}

export interface RssIngestorOptions {
  readonly fetchFn?: WebFetchFn;
  readonly clock?: Clock;
}

function parseTag(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!match?.[1]) return undefined;
  return match[1].trim();
}

function parseItemBlock(xml: string): RssItem {
  const title = parseTag(xml, 'title') ?? 'Untitled item';
  const link = parseTag(xml, 'link');
  const guid = parseTag(xml, 'guid');
  const description = parseTag(xml, 'description');
  const contentHtml = parseTag(xml, 'content:encoded');
  const categories = Array.from(xml.matchAll(/<category[^>]*>([\s\S]*?)<\/category>/gi)).map(match => match[1]!.trim()).filter(Boolean);
  const publishedAt = parseTag(xml, 'pubDate');
  return { title, link, guid, description, contentHtml, categories, publishedAt };
}

function parseFeed(xml: string): { feedTitle: string; items: RssItem[] } {
  const feedTitle = parseTag(xml, 'title') ?? 'RSS feed';
  const items = Array.from(xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)).map(match => parseItemBlock(match[0]!));
  return { feedTitle, items };
}

function stableId(seed: string): string {
  return createHash('sha256').update(seed).digest('hex').slice(0, 16);
}

function canonicalRssId(feedUrl: string, item: RssItem): string {
  if (item.link && item.link.trim().length > 0) {
    return `web:${urlCanonical(item.link)}`;
  }
  if (item.guid && item.guid.trim().length > 0) {
    return `rss:${feedUrl}#${item.guid.trim()}`;
  }
  return `rss:${stableId(`${feedUrl}|${item.title}|${item.publishedAt ?? ''}`)}`;
}

function summarizeItem(item: RssItem): string {
  const text = item.contentHtml ?? item.description ?? '';
  return extractTextFromHtml(text).text || item.title;
}

function feedContext(feedTitle: string, item: RssItem): ExtractionContext {
  return {
    sourceSummary: feedTitle,
    topicsOfInterest: item.categories.length > 0 ? [...item.categories] : undefined,
    chunkingHints: ['prose'],
  };
}

class RssContextProvider implements IContextProvider {
  async build(raw: RawSource, _config: ResolvedConfig): Promise<ExtractionContext> {
    const payload = raw.payload as RssFeedPayload | undefined;
    if (!payload) {
      return {};
    }
    return feedContext(payload.feedTitle, payload.item);
  }
}

export class RssIngestor implements IIngestor<RssFeedPayload> {
  readonly sourceId = 'rss';

  private readonly fetcher: HttpWebFetcher;
  private readonly clock?: Clock;

  constructor(options: RssIngestorOptions = {}) {
    this.fetcher = new HttpWebFetcher(options.fetchFn);
    this.clock = options.clock;
  }

  async acquire(input: IngestInput): Promise<Result<RawSource & { payload: RssFeedPayload }>> {
    const feedResult = await this.fetcher.fetch({ url: input.ref });
    if (!feedResult.ok) return feedResult;

    const xml = feedResult.value.html;
    const { feedTitle, items } = parseFeed(xml);
    const requestedGuid = typeof input.metadata?.['itemGuid'] === 'string' ? input.metadata['itemGuid'] as string : undefined;
    const item = requestedGuid ? items.find(entry => entry.guid === requestedGuid) ?? items[0] : items[0];
    if (!item) {
      return { ok: false, error: new Error(`RSS feed has no items: ${input.ref}`) };
    }

    const articleUrl = item.link && item.link.trim().length > 0 ? item.link : undefined;
    const needsArticleFetch = articleUrl !== undefined && (!item.description || item.description.trim().length < 120) && !item.contentHtml;
    let articleHtml = item.contentHtml ?? item.description ?? '';
    if (needsArticleFetch && articleUrl) {
      const articleResult = await this.fetcher.fetch({ url: articleUrl });
      if (articleResult.ok) {
        articleHtml = articleResult.value.html;
      }
    }

    const payload: RssFeedPayload = {
      feedUrl: input.ref,
      feedTitle,
      item,
      articleHtml,
    };

    const canonicalId = canonicalRssId(input.ref, item);
    const dedupKeys = new Set<string>([input.ref]);
    if (item.guid) dedupKeys.add(item.guid);
    if (articleUrl) {
      dedupKeys.add(articleUrl);
      dedupKeys.add(urlCanonical(articleUrl));
    }
    if (feedResult.value.url) {
      dedupKeys.add(feedResult.value.url);
    }

    return {
      ok: true,
      value: {
        canonicalId,
        dedupKeys: Array.from(dedupKeys),
        sourceType: 'rss',
        sensitivity: 'public',
        provenance: {
          sourceUri: input.ref,
          ingestedAt: (this.clock?.now() ?? new Date()).toISOString(),
          sourceType: 'rss',
        },
        resourceMetadata: {
          title: item.title,
          feedTitle,
          feedUrl: input.ref,
          ...(item.guid ? { itemGuid: item.guid } : {}),
          ...(articleUrl ? { articleUrl, canonicalUrl: urlCanonical(articleUrl) } : {}),
          ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
          ...(item.categories.length > 0 ? { categories: [...item.categories] } : {}),
        },
        payload,
        label: item.title,
      },
    };
  }
}

export class RssTextDecodeStrategy implements IDecodeStrategy {
  readonly name = 'text-extract:rss';

  async decode(input: DecodeInput): Promise<Result<DecodeOutput>> {
    if (input.raw.sourceType !== 'rss') {
      return { ok: false, error: new Error(`RssTextDecodeStrategy expected sourceType=rss, got ${input.raw.sourceType}`) };
    }
    const payload = input.raw.payload as RssFeedPayload | undefined;
    if (!payload) {
      return { ok: false, error: new Error('RssTextDecodeStrategy expected RssFeedPayload') };
    }

    const extracted = extractTextFromHtml(payload.articleHtml || summarizeItem(payload.item), { sourceId: input.raw.canonicalId });
    return {
      ok: true,
      value: {
        segments: extracted.segments,
        warnings: [],
      },
    };
  }
}

export const RssSourceRegistration: SourceRegistration = {
  sourceId: 'rss',
  validateActiveSourceConfig: (value: unknown) => value,
};

export function createRssVectorSpec(fetchFn?: WebFetchFn, clock?: Clock) {
  return {
    sourceId: 'rss',
    sensitivity: 'public' as const,
    ingestor: new RssIngestor({ ...(fetchFn ? { fetchFn } : {}), ...(clock ? { clock } : {}) }),
    decode: [new RssTextDecodeStrategy()],
    context: new RssContextProvider(),
    chunking: 'token-window' as const,
    registration: RssSourceRegistration,
  };
}

export * from './podcast.js';
