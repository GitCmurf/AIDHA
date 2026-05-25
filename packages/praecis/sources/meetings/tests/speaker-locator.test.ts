import { describe, expect, it } from 'vitest';
import { createPipelineRuntime, type LlmClient, type PipelineServices } from '@aidha/praecis-core';
import { createMeetingVectorSpec } from '../src/index.js';

describe('speaker locator', () => {
  it('preserves diarized speaker labels through runtime excerpts and claims', async () => {
    const llm: LlmClient = {
      async generate(request) {
        const excerptId = /"id":\s*"([^"]+)"/.exec(request.user)?.[1] ?? 'chunk-0';
        return {
          ok: true,
          value: JSON.stringify({
            claims: [{
              text: 'Alice and Bob have separate reviewable responsibilities.',
              excerptIds: [excerptId],
              confidence: 0.83,
              type: 'fact',
              classification: 'fact',
              startSeconds: 0,
              evidenceType: 'direct',
              why: 'Synthesized by the canonical extractor test double.',
            }],
          }),
        };
      },
    };
    const config: PipelineServices['config'] = {
      baseDir: process.cwd(),
      db: ':memory:',
      llm: {
        model: 'test-model',
        apiKey: '',
        baseUrl: 'http://localhost/v1',
        timeoutMs: 1000,
        cacheDir: '',
        reasoningEffort: 'medium',
        verbosity: 'medium',
        embeddingBatchSize: 20,
        embeddingTaskType: 'SEMANTIC_SIMILARITY',
        embeddingOutputDimensionality: 768,
      },
      editor: {
        version: 'v2',
        windowMinutes: 5,
        maxPerWindow: 3,
        minWindows: 1,
        minWords: 1,
        minChars: 1,
        editorLlm: false,
      },
      extraction: { maxClaims: 3, chunkMinutes: 5, maxChunks: 0, promptVersion: 'v2' },
      export: { outDir: './out', sourcePrefix: 'test' },
    };
    const vector = createMeetingVectorSpec({
      readFileFn: async () => Buffer.from('alpha beta gamma delta epsilon zeta eta theta iota kappa'),
      mockTranscriber: { transcriptText: 'Alice owns the launch plan. Bob owns the review gate.' },
      mockDiarizer: { speakerLabels: ['Alice', 'Bob'] },
    });
    const runtime = createPipelineRuntime({ config, llm });
    runtime.register(vector);

    const result = await runtime.run('meeting', { ref: 'fixture.wav' });

    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.segments.some(segment => segment.locator.kind === 'timecode' && segment.locator.speaker)).toBe(true);
    expect(result.value.excerptCount).toBeGreaterThan(0);
    expect(result.value.claimsExtracted).toBeGreaterThan(0);
    expect(result.value.claims.every(claim => claim.metadata?.['method'] === 'llm')).toBe(true);
  }, 30_000);
});
