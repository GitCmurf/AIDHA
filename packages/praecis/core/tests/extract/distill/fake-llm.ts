// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import type { LlmClient, LlmCompletionResult } from '../../../src/extract/llm-client.js';
import type { Chunk, MiningRequest } from '../../../src/interfaces/index.js';
import { DISTILLATION_SCHEMA_VERSION } from '../../../src/extract/distill/schema.js';

// ── FakeLlmClient ────────────────────────────────────────────────────────────

export class FakeLlmClient implements LlmClient {
  public requests: Array<{ system: string; user: string }> = [];
  constructor(private responses: string[]) {}
  async generate(request: { system: string; user: string }): Promise<LlmCompletionResult> {
    this.requests.push({ system: request.system, user: request.user });
    const next = this.responses.shift();
    if (next === undefined) return { ok: false, error: new Error('FakeLlmClient exhausted') };
    return { ok: true, value: next, usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 } };
  }
}

// ── chunk helper ─────────────────────────────────────────────────────────────

export function chunk(id: string, text: string, startSec: number): Chunk {
  return {
    id,
    text,
    segments: [],
    locator: { kind: 'timecode', startSec, endSec: startSec + 60 },
  };
}

// ── miningRequest helper ─────────────────────────────────────────────────────

export function miningRequest(llm: LlmClient, chunks?: Chunk[]): MiningRequest {
  const EX1_TEXT = 'The agent reads index files and follows explicit links instead of using embedding similarity over chunks.';
  const EX2_TEXT = 'For very large enterprise corpora the markdown approach scales poorly compared with traditional RAG systems.';
  return {
    raw: { canonicalId: 'res-1', sourceType: 'youtube', sensitivity: 'public', label: 'Test Video', payload: {} },
    chunks: chunks ?? [chunk('ex1', EX1_TEXT, 0), chunk('ex2', EX2_TEXT, 60)],
    context: {},
    config: { llm: { model: 'gpt-5.4-mini' }, extraction: {} },
    policyRoute: 'cloud',
    llm,
    costCeiling: {},
  } as unknown as MiningRequest;
}

// ── distillResponse helper ───────────────────────────────────────────────────

export interface DistillResponseOverrides {
  sourceType?: string;
  sourceCoherence?: string;
  theses?: string[];
}

export function distillResponse(units: unknown[], overrides: DistillResponseOverrides = {}): string {
  return JSON.stringify({
    schemaVersion: DISTILLATION_SCHEMA_VERSION,
    sourceType: overrides.sourceType ?? 'explainer',
    sourceCoherence: overrides.sourceCoherence ?? 'single_topic',
    theses: overrides.theses ?? ['Markdown wikis with explicit links are a viable retrieval alternative for small corpora.'],
    units,
  });
}
