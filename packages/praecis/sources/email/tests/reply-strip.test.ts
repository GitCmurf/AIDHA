import { describe, expect, it } from 'vitest';
import { stripEmailReply } from '../src/index.js';

describe('reply strip', () => {
  it('removes quoted replies and signatures while preserving the new response', () => {
    const result = stripEmailReply([
      'The launch note is ready for review.',
      '',
      '-- ',
      'Alice',
      '',
      'On Thu, Bob wrote:',
      '> Old launch note',
    ].join('\n'));

    expect(result).toBe('The launch note is ready for review.');
    expect(result).not.toContain('Old launch note');
  });

  it('removes Outlook original-message blocks from multi-reply threads', () => {
    const result = stripEmailReply([
      'Current reply with the actual decision.',
      '',
      '-----Original Message-----',
      'From: Bob <bob@example.com>',
      'Subject: Prior decision',
      'Previous reply that should not become an excerpt.',
    ].join('\n'));

    expect(result).toBe('Current reply with the actual decision.');
  });
});
