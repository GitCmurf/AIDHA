import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createMeetingVectorSpec, MeetingIngestor } from '../src/index.js';
import type { ResolvedConfig } from '@aidha/config';

const runtimeContext = {
  config: {} as ResolvedConfig,
  clock: { now: () => new Date('2026-05-25T12:34:56.000Z') },
};

function makeTempMeeting(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'aidha-meeting-'));
  const file = join(dir, 'standup.wav');
  writeFileSync(file, contents, 'utf8');
  return file;
}

describe('MeetingIngestor', () => {
  it('hashes file bytes into a canonical meeting identity', async () => {
    const file = makeTempMeeting('alpha beta gamma delta');
    try {
      const ingestor = new MeetingIngestor();
      const result = await ingestor.acquire({ ref: file }, runtimeContext);

      expect(result.ok).toBe(true);
      if (!result.ok) throw result.error;

      const expectedHash = createHash('sha256').update(Buffer.from('alpha beta gamma delta', 'utf8')).digest('hex');
      expect(result.value.canonicalId).toBe(`meeting:${expectedHash}`);
      expect(result.value.sensitivity).toBe('confidential');
      expect(result.value.payload.uri).toBe(`meeting:${expectedHash}`);
      expect(result.value.resourceMetadata).toMatchObject({
        title: 'standup.wav',
        filePath: file,
        sha256: expectedHash,
        mimeType: 'audio/wav',
      });
    } finally {
      rmSync(file, { force: true });
      rmSync(join(file, '..'), { recursive: true, force: true });
    }
  });
});

describe('createMeetingVectorSpec', () => {
  it('uses the injected clock for provenance timestamps', async () => {
    const file = makeTempMeeting('clocked meeting audio');
    try {
      const vector = createMeetingVectorSpec();
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

  it('builds a composed meeting vector that transcribes and diarizes', async () => {
    const file = makeTempMeeting('standup transcript alpha beta gamma delta epsilon zeta eta theta');
    try {
      const vector = createMeetingVectorSpec();
      const result = await vector.ingestAndDecode({ ref: file }, runtimeContext);

      expect(result.ok).toBe(true);
      if (!result.ok) throw result.error;
      expect(result.value.raw.canonicalId.startsWith('meeting:')).toBe(true);
      expect(result.value.segments.length).toBeGreaterThan(0);
      expect(result.value.segments[0]!.locator.kind).toBe('timecode');
      expect(result.value.segments[0]!.label).toBeDefined();
    } finally {
      rmSync(file, { force: true });
      rmSync(join(file, '..'), { recursive: true, force: true });
    }
  });
});
