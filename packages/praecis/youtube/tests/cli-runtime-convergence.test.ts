// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

describe('YouTube CLI runtime convergence', () => {
  it('uses the shared Praecis runtime for ingestion instead of the legacy fork', async () => {
    const cliSource = await readFile(join(process.cwd(), 'src', 'cli.ts'), 'utf8');

    expect(cliSource).toContain('createPipelineRuntime');
    expect(cliSource).toContain('createYouTubeVectorSpec');
    expect(cliSource).not.toContain('new IngestionPipeline');
    expect(cliSource).not.toContain('new ClaimExtractionPipeline');
  });
});
