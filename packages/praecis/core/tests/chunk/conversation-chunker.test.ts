import { describe, expect, it } from 'vitest';
import { ConversationChunker } from '../../src/chunk/conversation-chunker.js';
import type { ExtractionContext, MediaSegment } from '../../src/types/index.js';

const context: ExtractionContext = {};

function timecodeSegment(id: string, startSec: number, endSec: number, text: string, speaker?: string): MediaSegment {
  return {
    id,
    locator: { kind: 'timecode', startSec, endSec, ...(speaker ? { speaker } : {}) },
    text,
    ...(speaker ? { label: speaker } : {}),
  };
}

describe('ConversationChunker', () => {
  it('groups contiguous speaker turns into chunks', async () => {
    const result = await new ConversationChunker().chunk({
      segments: [
        timecodeSegment('s1', 0, 5, 'hello', 'Alice'),
        timecodeSegment('s2', 5, 10, 'world', 'Alice'),
        timecodeSegment('s3', 10, 15, 'next', 'Bob'),
      ],
      context,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;

    expect(result.value).toHaveLength(2);
    expect(result.value[0]!.text).toBe('hello world');
    expect(result.value[0]!.locator.kind).toBe('timecode');
    if (result.value[0]!.locator.kind !== 'timecode') return;
    expect(result.value[0]!.locator.speaker).toBe('Alice');
    expect(result.value[1]!.text).toBe('next');
  });
});
