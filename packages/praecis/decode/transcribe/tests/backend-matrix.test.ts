import { describe, expect, it } from 'vitest';
import { MockTranscriber, type TranscriptBackendName } from '../src/index.js';

describe('transcribe backend matrix', () => {
  it.each(['openai', 'groq', 'assemblyai', 'voxtral', 'nvidia', 'qwen', 'local', 'mock'] as TranscriptBackendName[])(
    'exposes %s behind the shared transcriber contract',
    async backend => {
      const transcriber = new MockTranscriber({ backend, transcriptText: `${backend} transcript has enough content for segmentation` });
      const result = await transcriber.transcribe({ uri: 'audio:test', mimeType: 'audio/wav' }, {});
      expect(result.ok).toBe(true);
      if (!result.ok) throw result.error;
      expect(transcriber.backend).toBe(backend);
      expect(result.value.length).toBeGreaterThan(0);
      expect(result.value[0]?.locator).toBeUndefined();
      expect(result.value[0]?.text).toContain(backend);
    },
  );
});
