import { describe, expect, it } from 'vitest';
import { InMemoryStore } from '@aidha/graph-backend';
import { reparentEmailThread, type EmailThread } from '../src/index.js';

describe('thread reparenting', () => {
  it('moves provisional leaf-thread excerpts under the final root thread id', async () => {
    const store = new InMemoryStore();
    await store.upsertNode('Resource', 'email:thread:msg-c', {
      label: 'Re: Project status',
      metadata: { canonicalId: 'email:thread:msg-c', sourceType: 'email', dedupKeys: ['email:thread:msg-c'] },
    });
    await store.upsertNode('Excerpt', 'email:thread:msg-c:excerpt:1', {
      label: 'Leaf body',
      metadata: {
        resourceId: 'email:thread:msg-c',
        locator: { kind: 'message', messageId: 'msg-c', charStart: 0, charEnd: 9 },
        sequence: 0,
      },
    });
    await store.upsertEdge('email:thread:msg-c', 'resourceHasExcerpt', 'email:thread:msg-c:excerpt:1', {
      metadata: { locator: { kind: 'message', messageId: 'msg-c', charStart: 0, charEnd: 9 }, sequence: 0 },
    });

    const thread: EmailThread = {
      threadId: 'email:thread:msg-a',
      rootMessageId: 'msg-a',
      subject: 'Project status',
      participants: ['Carol', 'Bob'],
      messages: [{
        filePath: 'leaf.eml',
        messageId: 'msg-c',
        threadId: 'email:thread:msg-a',
        rootMessageId: 'msg-a',
        subject: 'Re: Project status',
        from: 'Carol',
        to: ['Bob'],
        cc: [],
        bodyText: 'Leaf body',
        references: ['msg-a', 'msg-b'],
        inReplyTo: 'msg-b',
        attachments: [],
      }],
    };

    const result = await reparentEmailThread(store, thread);
    expect(result.ok).toBe(true);

    const finalNode = await store.getNode('email:thread:msg-a');
    const provisionalNode = await store.getNode('email:thread:msg-c');
    const edges = await store.getEdges({ subject: 'email:thread:msg-a', predicate: 'resourceHasExcerpt' });

    expect(finalNode.ok).toBe(true);
    expect(provisionalNode.ok).toBe(true);
    expect(edges.ok).toBe(true);
    if (!finalNode.ok || !provisionalNode.ok || !edges.ok) {
      throw new Error('store read failed');
    }
    expect(finalNode.value?.metadata?.['dedupKeys']).toContain('email:thread:msg-c');
    expect(provisionalNode.value).toBeNull();
    expect(edges.value.items[0]?.object).toBe('email:thread:msg-c:excerpt:1');
  });
});
