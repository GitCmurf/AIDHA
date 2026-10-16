import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const runFile = promisify(execFile);
const runner = fileURLToPath(new URL('./fixtures/parse-email-child.mjs', import.meta.url));

async function parseInChild(contents: string) {
  const directory = await mkdtemp(join(tmpdir(), 'aidha-email-budget-'));
  const file = join(directory, 'synthetic.eml');
  try {
    await writeFile(file, contents, 'utf8');
    const { stdout } = await runFile(process.execPath, [runner, file], {
      timeout: 15_000,
      maxBuffer: 64 * 1024,
    });
    return JSON.parse(stdout) as { messageId: string; bodyLength: number; recipientCount: number };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('email parser resource regressions', () => {
  it('finishes a malformed address header without blocking the importer', async () => {
    // GHSA-v53p-9fqp-m79j: the old free-text fallback repeatedly rescans this header.
    const header = ' >' + '>[x][x]'.repeat(40_000);
    const parsed = await parseInChild([
      'Message-ID: <address-budget@example.test>',
      `From: ${header}`,
      'To: recipient@example.test',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Synthetic body.',
    ].join('\r\n'));
    expect(parsed).toEqual({
      messageId: 'address-budget@example.test',
      bodyLength: 'Synthetic body.'.length,
      recipientCount: 1,
    });
  }, 20_000);

  it('finishes repeated mailto prefixes without blocking the importer', async () => {
    // GHSA-v245-v573-v5vm: text-to-HTML generation also invokes the link parser.
    const body = 'mailto:'.repeat(200_000);
    const parsed = await parseInChild([
      'Message-ID: <link-budget@example.test>',
      'From: sender@example.test',
      'To: recipient@example.test',
      'Content-Type: text/plain; charset=utf-8',
      '',
      body,
    ].join('\r\n'));
    expect(parsed).toEqual({
      messageId: 'link-budget@example.test',
      bodyLength: body.length,
      recipientCount: 1,
    });
  }, 20_000);
});
