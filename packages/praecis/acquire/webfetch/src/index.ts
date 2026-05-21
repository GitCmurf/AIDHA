// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import type { Result, IWebFetcher, WebFetchInput } from '@aidha/praecis-core';
import { urlCanonical } from '@aidha/praecis-core';

export interface WebFetchResponse {
  readonly url: string;
  readonly canonicalUrl: string;
  readonly title: string;
  readonly html: string;
}

export type WebFetchFn = (
  url: string,
  init?: { redirect?: 'follow' | 'manual' },
) => Promise<{
  ok: boolean;
  url: string;
  status: number;
  text(): Promise<string>;
}>;

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match?.[1]) {
    return '';
  }
  return match[1]
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export class HttpWebFetcher implements IWebFetcher {
  readonly backend = 'http-fetch';

  constructor(private readonly fetchFn: WebFetchFn = globalThis.fetch.bind(globalThis)) {}

  async fetch(input: WebFetchInput): Promise<Result<WebFetchResponse>> {
    try {
      const response = await this.fetchFn(input.url, {
        redirect: input.options?.followRedirects === false ? 'manual' : 'follow',
      });

      if (!response.ok) {
        return {
          ok: false,
          error: new Error(`web fetch failed for ${input.url}: HTTP ${response.status}`),
        };
      }

      const html = await response.text();
      const resolvedUrl = response.url || input.url;

      return {
        ok: true,
        value: {
          url: resolvedUrl,
          canonicalUrl: urlCanonical(resolvedUrl),
          title: extractTitle(html) || resolvedUrl,
          html,
        },
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }
}
