import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { parseEmailFile } from '../src/index.js';

it('preserves encoded headers, thread references, HTML preference and attachments', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aidha-email-mime-'));
  try {
    const file = join(directory, 'synthetic.eml');
    await writeFile(file, [
      'Message-ID: <mime@example.test>',
      'Date: Fri, 22 May 2026 10:00:00 +0000',
      'From: =?UTF-8?Q?Alice_Caf=C3=A9?= <alice@example.test>',
      'To: "Bob, Builder" <bob@example.test>, team@example.test',
      'Cc: =?UTF-8?Q?Chlo=C3=A9?= <chloe@example.test>',
      'Subject: MIME compatibility',
      'References: <root@example.test> <parent@example.test>',
      'In-Reply-To: <parent@example.test>',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="outer"',
      '',
      '--outer',
      'Content-Type: multipart/alternative; boundary="inner"',
      '',
      '--inner',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Plain fallback.',
      '--inner',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>Reviewed <b>message</b>.</p>',
      '--inner--',
      '--outer',
      'Content-Type: text/plain',
      "Content-Disposition: attachment; filename*=UTF-8''caf%C3%A9.txt",
      'Content-Transfer-Encoding: base64',
      '',
      'aGVsbG8=',
      '--outer--',
      '',
    ].join('\r\n'), 'utf8');

    expect(await parseEmailFile(file)).toEqual({
      filePath: file,
      messageId: 'mime@example.test',
      threadId: 'email:thread:root@example.test',
      rootMessageId: 'root@example.test',
      subject: 'MIME compatibility',
      from: 'Alice Café',
      to: ['Bob, Builder', 'team@example.test'],
      cc: ['Chloé'],
      date: '2026-05-22T10:00:00.000Z',
      bodyText: 'Reviewed message.',
      rawBodyText: 'Plain fallback.',
      rawHtml: '<p>Reviewed <b>message</b>.</p>',
      references: ['root@example.test', 'parent@example.test'],
      inReplyTo: 'parent@example.test',
      attachments: [{ filename: 'café.txt', contentType: 'text/plain', size: 5 }],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
