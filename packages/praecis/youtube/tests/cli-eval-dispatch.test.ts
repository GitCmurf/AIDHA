import { describe, it, expect, vi } from 'vitest';
import { runCli } from '../src/cli.js';
import * as cliEval from '../src/cli-eval.js';

describe('CLI Eval Dispatch', () => {
  it('dispatches to runEvalMatrix for eval matrix', async () => {
    const mockRunEvalMatrix = vi.spyOn(cliEval, 'runEvalMatrix').mockResolvedValue(0);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      const code = await runCli(['eval', 'matrix', '--corpus', 'dummy.json']);
      expect(mockRunEvalMatrix).toHaveBeenCalled();
      expect(code).toBe(0);
    } finally {
      mockRunEvalMatrix.mockRestore();
      consoleError.mockRestore();
      consoleLog.mockRestore();
    }
  });

  it('dispatches to runEvalMatrix for eval narrow-manual-baseline', async () => {
    const mockRunEvalMatrix = vi.spyOn(cliEval, 'runEvalMatrix').mockResolvedValue(0);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      const code = await runCli(['eval', 'narrow-manual-baseline', '--corpus', 'dummy.json']);
      expect(mockRunEvalMatrix).toHaveBeenCalled();
      expect(code).toBe(0);
    } finally {
      mockRunEvalMatrix.mockRestore();
      consoleError.mockRestore();
      consoleLog.mockRestore();
    }
  });

  it('returns error for unknown eval mode', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const code = await runCli(['eval', 'unknown-mode']);
      expect(code).toBe(1);
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('Usage: eval <matrix|narrow-manual-baseline>'));
    } finally {
      consoleError.mockRestore();
    }
  });
});
