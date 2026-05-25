// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '../../../../..');

function sourceFiles(root: string): string[] {
  const entries = readdirSync(root);
  return entries.flatMap(entry => {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory() && (entry === 'node_modules' || entry === 'dist')) return [];
    if (stat.isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

function relative(path: string): string {
  return path.slice(repoRoot.length + 1);
}

describe('production ingestion assembly', () => {
  it('keeps vector packages behind the configured ingestion runtime', () => {
    const roots = [
      join(repoRoot, 'packages/praecis/cli/src'),
      join(repoRoot, 'packages/praecis/sources'),
      join(repoRoot, 'packages/praecis/youtube/src/ingest'),
    ];
    const offenders = roots
      .flatMap(sourceFiles)
      .filter(path => path.includes('/src/'))
      .filter(path => /create(DefaultPipelineServices|PipelineRuntime)/.test(readFileSync(path, 'utf8')))
      .map(relative);

    expect(offenders).toEqual([]);
  });

  it('centralizes taxonomy assignment metadata writes in the core helper', () => {
    const offenders = sourceFiles(join(repoRoot, 'packages/praecis'))
      .filter(path => path.includes('/src/'))
      .filter(path => !path.includes('/node_modules/'))
      .filter(path => !path.includes('/dist/'))
      .filter(path => !path.endsWith('src/pipeline/taxonomy-metadata.ts'))
      .filter(path => readFileSync(path, 'utf8').includes('taxonomyAssignments'))
      .map(relative);

    expect(offenders).toEqual([]);
  });
});
