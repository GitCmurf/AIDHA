// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../src/cli.js';

describe('YouTube CLI runtime convergence', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('continues playlist ingestion through the production runtime when one video fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aidha-youtube-cli-convergence-'));
    const dbPath = join(dir, 'aidha.sqlite');
    const logs: string[] = [];
    const errors: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((value?: unknown) => {
      logs.push(String(value));
    });
    vi.spyOn(console, 'error').mockImplementation((value?: unknown) => {
      errors.push(String(value));
    });

    try {
      const code = await runCli(['ingest', 'playlist', 'partial-playlist', '--db', dbPath, '--mock']);

      expect(code).toBe(0);
      expect(logs).toContain('Ingested playlist partial-playlist: 1 videos');
      expect(logs).toContain('Errors: 1');
      expect(errors).toContain('missing-video: Video not found: missing-video');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
