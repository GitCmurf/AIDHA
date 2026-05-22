import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEmailFile } from '../src/index.js';

async function makeEmailFile(contents: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'aidha-email-'));
  const file = join(dir, 'message.eml');
  await writeFile(file, contents);
  return file;
}

describe('parseEmailFile', () => {
  it('parses headers and strips quoted replies and signatures', async () => {
    const file = await makeEmailFile([
      'Message-ID: <msg-c>',
      'Date: Thu, 22 May 2026 10:00:00 +0000',
      'From: Alice <alice@example.com>',
      'To: Bob <bob@example.com>',
      'Subject: Re: Project status',
      'In-Reply-To: <msg-b>',
      '',
      'Hello Bob,',
      '',
      'Thanks for the update.',
      '',
      'On Thu, 22 May 2026 at 09:00 Bob <bob@example.com> wrote:',
      '> Earlier reply',
      '',
      '-- ',
      'Alice',
    ].join('\r\n'));

    const result = await parseEmailFile(file);
    expect(result.messageId).toBe('msg-c');
    expect(result.threadId).toBe('email:thread:msg-b');
    expect(result.rootMessageId).toBe('msg-b');
    expect(result.subject).toBe('Re: Project status');
    expect(result.bodyText).toBe('Hello Bob,\n\nThanks for the update.');
    expect(result.from).toBe('Alice');
    expect(result.to).toEqual(['Bob']);
  });
});
