import { describe, expect, it } from 'vitest';
import { parseConfiguredRuntimes } from '../src/client/yt-dlp.js';

describe('yt-dlp JS runtime parsing', () => {
  it('preserves windows drive letters when no label is provided', () => {
    const entries = parseConfiguredRuntimes('C:\\Program Files\\nodejs\\node.exe');
    expect(entries[0]?.label).toBe('C:\\Program Files\\nodejs\\node.exe');
    expect(entries[0]?.executable).toBe('C:\\Program Files\\nodejs\\node.exe');
  });

  it('splits label from a windows runtime path', () => {
    const entries = parseConfiguredRuntimes('node:C:\\Program Files\\nodejs\\node.exe');
    expect(entries[0]?.label).toBe('node');
    expect(entries[0]?.executable).toBe('C:\\Program Files\\nodejs\\node.exe');
  });
});
