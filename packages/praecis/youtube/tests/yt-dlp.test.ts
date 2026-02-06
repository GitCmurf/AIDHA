import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchTranscriptWithYtDlp } from '../src/client/yt-dlp.js';

describe('yt-dlp fallback', () => {
  let scriptPath: string;
  let scriptDir: string;
  const originalEnv = {
    AIDHA_YTDLP_BIN: process.env['AIDHA_YTDLP_BIN'],
    AIDHA_YTDLP_KEEP_FILES: process.env['AIDHA_YTDLP_KEEP_FILES'],
  };

  beforeEach(async () => {
    scriptDir = await fs.mkdtemp(join(tmpdir(), 'aidha-ytdlp-test-'));
    scriptPath = join(scriptDir, 'yt-dlp');
    const script = [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      '',
      'output_template=""',
      'while [[ $# -gt 0 ]]; do',
      '    case "$1" in',
      '        --output)',
      '            output_template="$2"',
      '            shift 2',
      '            ;;',
      '        *)',
      '            shift 1',
      '            ;;',
      '    esac',
      'done',
      '',
      'if [[ -z "$output_template" ]]; then',
      '    echo "missing output template" >&2',
      '    exit 1',
      'fi',
      '',
      'output_path="${output_template//%(id)s/test-video}"',
      'output_path="${output_path//%(ext)s/vtt}"',
      'mkdir -p "$(dirname "$output_path")"',
      'cat > "$output_path" <<\'EOF\'',
      'WEBVTT',
      '',
      '00:00:01.000 --> 00:00:02.000',
      'Hello from yt-dlp',
      'EOF',
      '',
    ].join('\n');
    await fs.writeFile(scriptPath, script, 'utf-8');
    await fs.chmod(scriptPath, 0o755);
    process.env['AIDHA_YTDLP_BIN'] = scriptPath;
    process.env['AIDHA_YTDLP_KEEP_FILES'] = '0';
  });

  afterEach(async () => {
    if (originalEnv.AIDHA_YTDLP_BIN === undefined) {
      delete process.env['AIDHA_YTDLP_BIN'];
    } else {
      process.env['AIDHA_YTDLP_BIN'] = originalEnv.AIDHA_YTDLP_BIN;
    }
    if (originalEnv.AIDHA_YTDLP_KEEP_FILES === undefined) {
      delete process.env['AIDHA_YTDLP_KEEP_FILES'];
    } else {
      process.env['AIDHA_YTDLP_KEEP_FILES'] = originalEnv.AIDHA_YTDLP_KEEP_FILES;
    }
    if (scriptDir) {
      await fs.rm(scriptDir, { recursive: true, force: true });
    }
  });

  it('returns transcript segments from yt-dlp output', async () => {
    const result = await fetchTranscriptWithYtDlp('test-video');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.segments.length).toBeGreaterThan(0);
    expect(result.value.fullText).toContain('Hello from yt-dlp');
  });

  it('normalizes videoId when input is a URL', async () => {
    const result = await fetchTranscriptWithYtDlp('https://www.youtube.com/watch?v=test-video');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.videoId).toBe('test-video');
  });
});
