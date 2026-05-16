import { describe, expectTypeOf, it } from 'vitest';
import type { AidhaConfig, LlmConfig, ResolvedConfig, SourceRegistration } from '../src/types.js';

describe('config public types', () => {
  it('should expose embedding fields on on-disk LLM config', () => {
    expectTypeOf<LlmConfig>().toHaveProperty('embedding_batch_size').toEqualTypeOf<number | undefined>();
    expectTypeOf<LlmConfig>()
      .toHaveProperty('embedding_task_type')
      .toEqualTypeOf<
        | 'SEMANTIC_SIMILARITY'
        | 'RETRIEVAL_QUERY'
        | 'RETRIEVAL_DOCUMENT'
        | 'CLASSIFICATION'
        | 'CLUSTERING'
        | undefined
      >();
    expectTypeOf<LlmConfig>().toHaveProperty('embedding_output_dimensionality').toEqualTypeOf<number | undefined>();
  });

  it('should expose normalized embedding fields on resolved config', () => {
    expectTypeOf<ResolvedConfig['llm']>().toHaveProperty('embeddingBatchSize').toEqualTypeOf<number>();
    expectTypeOf<ResolvedConfig['llm']>()
      .toHaveProperty('embeddingTaskType')
      .toEqualTypeOf<
        | 'SEMANTIC_SIMILARITY'
        | 'RETRIEVAL_QUERY'
        | 'RETRIEVAL_DOCUMENT'
        | 'CLASSIFICATION'
        | 'CLUSTERING'
      >();
    expectTypeOf<ResolvedConfig['llm']>().toHaveProperty('embeddingOutputDimensionality').toEqualTypeOf<number>();
  });

  it('should expose source boundary fields on ResolvedConfig', () => {
    expectTypeOf<ResolvedConfig>().toHaveProperty('activeSourceId').toEqualTypeOf<string | undefined>();
    expectTypeOf<ResolvedConfig>().toHaveProperty('activeSourceConfig').toEqualTypeOf<unknown>();
  });

  it('should expose SourceRegistration with required contract methods', () => {
    expectTypeOf<SourceRegistration>().toHaveProperty('sourceId').toEqualTypeOf<string>();
    expectTypeOf<SourceRegistration>().toHaveProperty('validateActiveSourceConfig').toBeFunction();
  });

  it('should allow source_overrides in profiles', () => {
    expectTypeOf<AidhaConfig['profiles']['default']>().toHaveProperty('source_overrides');
  });
});
