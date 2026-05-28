import { describe, expect, it } from 'vitest';
import { MockDiarizer, NoOpDiarizer, type DiarizationBackendName } from '../src/index.js';

const segments = [{ id: 'seg-1', startSec: 0, endSec: 5, text: 'hello world' }];

describe('diarize backend matrix', () => {
  it.each(['assemblyai', 'pyannote', 'whisperx', 'mock'] as DiarizationBackendName[])(
    'exposes %s behind the shared diarizer contract',
    async backend => {
      const diarizer = new MockDiarizer({ backend, speakerLabels: ['Alice'] });
      const result = await diarizer.diarize({ uri: 'audio:test', mimeType: 'audio/wav' }, segments);
      expect(result.ok).toBe(true);
      if (!result.ok) throw result.error;
      expect(diarizer.backend).toBe(backend);
      expect(result.value[0]?.speaker).toBe('Alice');
    },
  );

  it('supports none pass-through with normalized speaker labels', async () => {
    const diarizer = new NoOpDiarizer();
    const result = await diarizer.diarize({ uri: 'audio:test', mimeType: 'audio/wav' }, segments);
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value[0]?.speaker).toBe('Speaker 1');
  });
});
