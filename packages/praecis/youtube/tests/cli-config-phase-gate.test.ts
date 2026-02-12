import { describe, it, expect, vi } from 'vitest';
import { runCli } from '../src/cli.js';

describe('CLI Config Phase Gate (Phase 2A)', () => {
  it('set command is blocked (Phase 2B)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Commands like 'config set foo bar'
    const code = await runCli(['config', 'set', 'foo', 'bar']);

    expect(code).toBe(1);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('Phase 2B'));
  });
});
