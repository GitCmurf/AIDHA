import { describe, expect, it } from 'vitest';
import { createPipelineRuntime } from '@aidha/praecis-core';
import { createMeetingVectorSpec } from '../src/index.js';

describe('speaker locator', () => {
  it('preserves diarized speaker labels through runtime excerpts and claims', async () => {
    const vector = createMeetingVectorSpec({
      readFileFn: async () => Buffer.from('alpha beta gamma delta epsilon zeta eta theta iota kappa'),
      mockTranscriber: { transcriptText: 'Alice owns the launch plan. Bob owns the review gate.' },
      mockDiarizer: { speakerLabels: ['Alice', 'Bob'] },
    });
    const runtime = createPipelineRuntime();
    runtime.register(vector);

    const result = await runtime.run('meeting', { ref: 'fixture.wav' });

    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.segments.some(segment => segment.locator.kind === 'timecode' && segment.locator.speaker)).toBe(true);
    expect(result.value.excerptCount).toBeGreaterThan(0);
    expect(result.value.claimsExtracted).toBeGreaterThan(0);
  });
});
