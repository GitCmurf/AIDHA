// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Transcript, type Transcript as TranscriptValue } from '../schema/index.js';

const CACHE_SCHEMA_VERSION = 1;
const DEFAULT_LANGUAGE_KEY = 'en';

export interface TranscriptCacheConfig {
  readonly enabled: boolean;
  readonly dir: string;
  readonly refresh?: boolean;
}

interface CachedTranscriptPayload {
  readonly schemaVersion: number;
  readonly cacheKey: string;
  readonly videoId: string;
  readonly languageKey: string;
  readonly fetchedAt: string;
  readonly transcript: TranscriptValue;
}

function safeKey(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 24);
}

function cacheKey(videoId: string, languageKey = DEFAULT_LANGUAGE_KEY): string {
  return `youtube:${videoId}:language=${languageKey}:schema=v${CACHE_SCHEMA_VERSION}`;
}

function cachePath(config: TranscriptCacheConfig, videoId: string, languageKey = DEFAULT_LANGUAGE_KEY): string {
  return join(config.dir, `${safeKey(cacheKey(videoId, languageKey))}.json`);
}

function parseCachedTranscriptPayload(raw: string, expectedVideoId: string): TranscriptValue | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const payload = parsed as Partial<CachedTranscriptPayload>;
  if (payload.schemaVersion !== CACHE_SCHEMA_VERSION) return null;
  if (payload.videoId !== expectedVideoId) return null;
  const transcript = Transcript.safeParse(payload.transcript);
  return transcript.success ? transcript.data : null;
}

export async function readTranscriptCache(
  config: TranscriptCacheConfig | undefined,
  videoId: string,
): Promise<TranscriptValue | null> {
  if (!config?.enabled || config.refresh) return null;
  try {
    return parseCachedTranscriptPayload(await readFile(cachePath(config, videoId), 'utf8'), videoId);
  } catch {
    return null;
  }
}

export async function writeTranscriptCache(
  config: TranscriptCacheConfig | undefined,
  transcript: TranscriptValue,
  fetchedAt = new Date().toISOString(),
): Promise<void> {
  if (!config?.enabled) return;
  await mkdir(config.dir, { recursive: true });
  const key = cacheKey(transcript.videoId);
  const payload: CachedTranscriptPayload = {
    schemaVersion: CACHE_SCHEMA_VERSION,
    cacheKey: key,
    videoId: transcript.videoId,
    languageKey: DEFAULT_LANGUAGE_KEY,
    fetchedAt,
    transcript,
  };
  const target = cachePath(config, transcript.videoId);
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await rename(tmp, target);
}
