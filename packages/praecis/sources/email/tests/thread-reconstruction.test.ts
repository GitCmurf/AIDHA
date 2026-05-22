import { describe, expect, it } from 'vitest';
import { groupEmailMessages } from '../src/index.js';

describe('groupEmailMessages', () => {
  it('reparents a provisional thread when a later message reveals the true root', () => {
    const messages = groupEmailMessages([
      {
        filePath: '/tmp/c.eml',
        messageId: 'msg-c',
        threadId: 'email:thread:msg-b',
        rootMessageId: 'msg-b',
        subject: 'Re: Project',
        from: 'Carol',
        to: ['Bob'],
        cc: [],
        date: '2026-05-22T10:00:00.000Z',
        bodyText: 'Later leaf',
        references: [],
        inReplyTo: 'msg-b',
        attachments: [],
      },
      {
        filePath: '/tmp/b.eml',
        messageId: 'msg-b',
        threadId: 'email:thread:msg-a',
        rootMessageId: 'msg-a',
        subject: 'Re: Project',
        from: 'Bob',
        to: ['Alice'],
        cc: [],
        date: '2026-05-22T11:00:00.000Z',
        bodyText: 'Intermediate reply',
        references: ['msg-a'],
        inReplyTo: 'msg-a',
        attachments: [],
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]!.threadId).toBe('email:thread:msg-a');
    expect(messages[0]!.messages.map(message => message.messageId)).toEqual(['msg-c', 'msg-b']);
  });
});
