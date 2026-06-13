// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { afterEach, describe, expect, it } from 'vitest';
import { selectCandidateMiner, CanonicalLlmClaimMiner } from '../../../src/pipeline/services.js';
import { SourceDistillationMiner } from '../../../src/extract/distill/miner.js';

describe('selectCandidateMiner', () => {
  afterEach(() => {
    delete process.env['AIDHA_EXTRACTION_PATH'];
  });

  it('defaults to SourceDistillationMiner', () => {
    expect(selectCandidateMiner({})).toBeInstanceOf(SourceDistillationMiner);
  });

  it('selects the legacy chunk-mining path via AIDHA_EXTRACTION_PATH', () => {
    expect(selectCandidateMiner({ AIDHA_EXTRACTION_PATH: 'chunk-mining' })).toBeInstanceOf(CanonicalLlmClaimMiner);
  });

  it('passes extraction intent through', () => {
    const miner = selectCandidateMiner({}, { extractionIntent: 'runbook' });
    expect(miner).toBeInstanceOf(SourceDistillationMiner);
  });
});
