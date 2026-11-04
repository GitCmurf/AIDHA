// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { simpleParser } from 'mailparser';

const parseRecipients = (to: string) => simpleParser([
  'Message-ID: <synthetic-addresses@example.test>',
  'From: sender@example.test',
  `To: ${to}`,
  'Subject: Synthetic address identity regression',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Synthetic body.',
].join('\r\n'));

describe('mailparser recipient identity', () => {
  it('preserves ordinary quoted display names and multiple mailbox addresses', async () => {
    const parsed = await parseRecipients('"Recipient, Example" <recipient@example.test>, another@example.test');
    expect(parsed.to?.value?.map(value => value.address))
      .toEqual(['recipient@example.test', 'another@example.test']);
  });

  it('keeps a greater-than character inside a quoted local part within the intended mailbox', async () => {
    // GHSA-85x2-q946-cp5h: an angle-addr must not end inside its quoted local part.
    const parsed = await parseRecipients('<"a@attacker.example>"@recipient.example.test>');
    expect(parsed.to?.value?.map(value => value.address))
      .toEqual(['"a@attacker.example>"@recipient.example.test']);
  });

  it('keeps a semicolon inside a group comment from becoming a separate mailbox', async () => {
    // GHSA-m943-m63m-w62w: the group ends only at a semicolon outside comments and quotes.
    const parsed = await parseRecipients('G: (a; <attacker@example.test>) <recipient@example.test>;');
    expect(parsed.to?.value).toHaveLength(1);
    expect(parsed.to).toMatchObject({
      value: [{ group: [{ address: 'recipient@example.test' }] }],
    });
  });

  it('keeps a nested comment from replacing the intended mailbox with comment text', async () => {
    // GHSA-8c8m-p3m8-cjg8: only the closing parenthesis of the outer comment ends it.
    const parsed = await parseRecipients('Recipient (x(y) <attacker@example.test>) <recipient@example.test>');
    expect(parsed.to?.value?.map(value => value.address))
      .toEqual(['recipient@example.test']);
  });
});
