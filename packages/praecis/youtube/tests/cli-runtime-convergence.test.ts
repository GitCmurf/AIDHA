// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

describe('YouTube CLI runtime convergence', () => {
  it('uses the shared production ingest API instead of local CLI orchestration or the legacy fork', async () => {
    const cliSource = await readFile(join(process.cwd(), 'src', 'cli.ts'), 'utf8');
    const ingestSource = await readFile(join(process.cwd(), 'src', 'ingest', 'runtime-ingestion.ts'), 'utf8');

    expect(cliSource).toContain('ingestYouTubeVideo');
    expect(cliSource).not.toContain('createPipelineRuntime');
    expect(ingestSource).toContain('createIngestionRuntime');
    expect(ingestSource).not.toContain('createPipelineRuntime');
    expect(ingestSource).toContain('createYouTubeVectorSpec');
    expect(cliSource).not.toContain('new IngestionPipeline');
    expect(cliSource).not.toContain('new ClaimExtractionPipeline');
  });
});
