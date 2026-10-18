import type { LlmClient, LlmCompletionRequest, LlmCompletionResult } from '../../src/extract/llm-client.js';

/** Offline provider boundary: record real requests and reject unplanned calls. */
export class RecordingLlm implements LlmClient {
  readonly requests: LlmCompletionRequest[] = [];
  constructor(private readonly responses: string[]) {}
  async generate(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    this.requests.push(request);
    const value = this.responses.shift();
    if (value === undefined) throw new Error('No fictional response queued');
    return { ok: true, value, usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 } };
  }
}
