import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createVoiceVectorSpec, VoiceIngestor } from '../src/index.js';

function makeTempVoice(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'aidha-voice-'));
  const file = join(dir, 'note.m4a');
  writeFileSync(file, contents, 'utf8');
  return file;
}

describe('VoiceIngestor', () => {
  it('hashes file bytes into a canonical voice identity', async () => {
    const file = makeTempVoice('alpha beta gamma');
    try {
      const ingestor = new VoiceIngestor();
      const result = await ingestor.acquire({ ref: file });

      expect(result.ok).toBe(true);
      if (!result.ok) throw result.error;

      const expectedHash = createHash('sha256').update(Buffer.from('alpha beta gamma', 'utf8')).digest('hex');
      expect(result.value.canonicalId).toBe(`voice:${expectedHash}`);
      expect(result.value.payload.uri).toBe(`voice:${expectedHash}`);
      expect(result.value.payload.mimeType).toBe('audio/mp4');
    } finally {
      rmSync(file, { force: true });
      rmSync(join(file, '..'), { recursive: true, force: true });
    }
  });
});

describe('createVoiceVectorSpec', () => {
  it('builds a composed voice vector that transcribes deterministically', async () => {
    const file = makeTempVoice('voice note one two three four five six seven eight nine ten');
    try {
      const vector = createVoiceVectorSpec();
      const result = await vector.ingestAndDecode({ ref: file });

      expect(result.ok).toBe(true);
      if (!result.ok) throw result.error;
      expect(result.value.raw.canonicalId.startsWith('voice:')).toBe(true);
      expect(result.value.segments.length).toBeGreaterThan(0);
    } finally {
      rmSync(file, { force: true });
      rmSync(join(file, '..'), { recursive: true, force: true });
    }
  });
});
