import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createMeetingVectorSpec, MeetingIngestor } from '../src/index.js';

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
      const result = await ingestor.acquire({ ref: file });

      expect(result.ok).toBe(true);
      if (!result.ok) throw result.error;

      const expectedHash = createHash('sha256').update(Buffer.from('alpha beta gamma delta', 'utf8')).digest('hex');
      expect(result.value.canonicalId).toBe(`meeting:${expectedHash}`);
      expect(result.value.sensitivity).toBe('confidential');
      expect(result.value.payload.uri).toBe(`meeting:${expectedHash}`);
    } finally {
      rmSync(file, { force: true });
      rmSync(join(file, '..'), { recursive: true, force: true });
    }
  });
});

describe('createMeetingVectorSpec', () => {
  it('builds a composed meeting vector that transcribes and diarizes', async () => {
    const file = makeTempMeeting('standup transcript alpha beta gamma delta epsilon zeta eta theta');
    try {
      const vector = createMeetingVectorSpec();
      const result = await vector.ingestAndDecode({ ref: file });

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
