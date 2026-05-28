import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createVoiceVectorSpec, VoiceIngestor } from '../src/index.js';
import type { ResolvedConfig } from '@aidha/config';

const runtimeContext = {
  config: {} as ResolvedConfig,
  clock: { now: () => new Date('2026-05-25T12:34:56.000Z') },
};

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
      const result = await ingestor.acquire({ ref: file }, runtimeContext);

      expect(result.ok).toBe(true);
      if (!result.ok) throw result.error;

      const expectedHash = createHash('sha256').update(Buffer.from('alpha beta gamma', 'utf8')).digest('hex');
      expect(result.value.canonicalId).toBe(`voice:${expectedHash}`);
      expect(result.value.payload.uri).toBe(`voice:${expectedHash}`);
      expect(result.value.payload.mimeType).toBe('audio/mp4');
      expect(result.value.resourceMetadata).toMatchObject({
        title: 'note.m4a',
        filePath: file,
        sha256: expectedHash,
        mimeType: 'audio/mp4',
      });
    } finally {
      rmSync(file, { force: true });
      rmSync(join(file, '..'), { recursive: true, force: true });
    }
  });
});

describe('createVoiceVectorSpec', () => {
  it('uses the injected clock for provenance timestamps', async () => {
    const file = makeTempVoice('clocked voice note');
    try {
      const vector = createVoiceVectorSpec();
      const first = await vector.ingestAndDecode({ ref: file }, runtimeContext);
      const second = await vector.ingestAndDecode({ ref: file }, runtimeContext);

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      if (!first.ok) throw first.error;
      if (!second.ok) throw second.error;
      expect(first.value.raw.provenance.ingestedAt).toBe('2026-05-25T12:34:56.000Z');
      expect(second.value.raw.provenance).toEqual(first.value.raw.provenance);
    } finally {
      rmSync(file, { force: true });
      rmSync(join(file, '..'), { recursive: true, force: true });
    }
  });

  it('builds a composed voice vector that transcribes deterministically', async () => {
    const file = makeTempVoice('voice note one two three four five six seven eight nine ten');
    try {
      const vector = createVoiceVectorSpec();
      const result = await vector.ingestAndDecode({ ref: file }, runtimeContext);

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
