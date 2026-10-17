import type { LlmClient, LlmCompletionRequest, LlmCompletionResult } from '../../../src/extract/llm-client.js';
import type { MiningRequest } from '../../../src/interfaces/index.js';

export const source = 'The agent reads index files and follows explicit links instead of using embedding similarity over chunks. The committee chair describes this approach for small collections and records several further observations.';
export const unit = {
  id: 'u1', kind: 'idea', text: 'Agents can navigate a markdown wiki by reading index files and following explicit links.',
  stance: 'asserted', importance: 'core', evidence: [{ excerptId: 'ex1', quote: 'reads index files and follows explicit links' }],
};
export const payload = (units: unknown[] = [unit]): string => JSON.stringify({ schemaVersion: 1,
  sourceType: 'explainer', sourceCoherence: 'single_topic', theses: [], units });
export const grounded = JSON.stringify({ verdicts: [{ unitId: 'u1', verdict: 'grounded' }] });

export class RecordingLlm implements LlmClient {
  readonly requests: LlmCompletionRequest[] = [];
  constructor(private readonly responses: (string | Error | LlmCompletionResult)[]) {}
  async generate(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    this.requests.push(request);
    const next = this.responses.shift();
    if (next instanceof Error) throw next;
    if (next === undefined) throw new Error('No synthetic response queued');
    return typeof next === 'string' ? { ok: true, value: next, usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 } } : next;
  }
}

export const config = (): MiningRequest['config'] => ({
  baseDir: process.cwd(), db: ':memory:',
  llm: { model: 'synthetic-model', apiKey: '', baseUrl: '', timeoutMs: 1000, cacheDir: '',
    reasoningEffort: 'medium', verbosity: 'low', embeddingBatchSize: 20,
    embeddingTaskType: 'SEMANTIC_SIMILARITY', embeddingOutputDimensionality: 768 },
  editor: { version: 'v2', windowMinutes: 5, maxPerWindow: 3, minWindows: 1, minWords: 1, minChars: 1, editorLlm: false },
  extraction: { maxClaims: 3, chunkMinutes: 5, maxChunks: 0, promptVersion: 'v2' },
  export: { outDir: './out', sourcePrefix: 'synthetic' },
});
export const request = (llm: LlmClient): MiningRequest => ({
  raw: { canonicalId: 'synthetic:wiki', sourceType: 'web', sensitivity: 'public', payload: {} },
  chunks: [{ id: 'ex1', text: source, segments: [], locator: { kind: 'text', charStart: 0, charEnd: source.length } }],
  context: {}, config: config(), policyRoute: 'local', llm, costCeiling: {},
  clock: { now: () => new Date('2026-10-17T00:00:00Z') },
});
