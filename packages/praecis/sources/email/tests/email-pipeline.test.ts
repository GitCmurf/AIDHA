import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ResolvedConfig } from '@aidha/config';
import type { LlmClient, LlmCompletionRequest, PipelineServices, RunReport } from '@aidha/praecis-core';
import { InMemoryStore } from '@aidha/graph-backend';
import type { Result } from '@aidha/taxonomy';
import { createEmailVectorSpec, runEmailBatch, runEmailBatchWithContext } from '../src/index.js';

async function makeEmailDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'aidha-email-'));
}

async function writeEmailFile(dir: string, name: string, contents: string): Promise<string> {
  const file = join(dir, name);
  await writeFile(file, contents);
  return file;
}

function testConfig(): ResolvedConfig {
  return {
    baseDir: process.cwd(),
    db: ':memory:',
    llm: {
      model: 'test-model',
      apiKey: '',
      baseUrl: 'http://localhost/v1',
      timeoutMs: 1000,
      cacheDir: '',
      reasoningEffort: 'medium',
      verbosity: 'medium',
      embeddingBatchSize: 20,
      embeddingTaskType: 'SEMANTIC_SIMILARITY',
      embeddingOutputDimensionality: 768,
    },
    editor: {
      version: 'v2',
      windowMinutes: 5,
      maxPerWindow: 3,
      minWindows: 1,
      minWords: 1,
      minChars: 1,
      editorLlm: false,
    },
    extraction: {
      maxClaims: 3,
      chunkMinutes: 5,
      maxChunks: 0,
      promptVersion: 'v1',
    },
    export: {
      outDir: './out',
      sourcePrefix: '',
    },
  };
}

function fakeLlm(): LlmClient {
  return {
    async generate(request: LlmCompletionRequest): Promise<Result<string>> {
      const excerptId = request.user.match(/\bemail:[^\s\]")]+/u)?.[0] ?? 'email:excerpt';
      return {
        ok: true,
        value: JSON.stringify({
          claims: [{
            text: 'The email thread contains a project status update.',
            excerptIds: [excerptId],
            type: 'claim',
            classification: 'fact',
            domain: 'Work',
            confidence: 0.9,
            why: 'The message body states project status information.',
            method: 'llm',
          }],
        }),
      };
    },
  };
}

function services(): Partial<PipelineServices> {
  return { config: testConfig(), llm: fakeLlm() };
}

const fixedClock = { now: () => new Date('2026-05-25T12:34:56.000Z') };
const runtimeContext = {
  config: testConfig(),
  clock: fixedClock,
};

function reportFor(ref: string): RunReport {
  return {
    sourceId: 'email',
    canonicalId: 'email:thread:good-msg',
    resourceId: 'email:thread:good-msg',
    excerptCount: 1,
    chunkCount: 1,
    segmentCount: 1,
    segments: [],
    chunks: [],
    excerptIds: ['email:excerpt:good-msg'],
    claimsExtracted: 0,
    claimIds: [],
    claims: [],
    dedupAction: 'create',
    policyRoute: 'disabled',
    cacheHits: 0,
    cacheWrites: 0,
    tokenUsage: 0,
    spendUsd: 0,
    warnings: [],
    classification: { status: 'disabled', tagsMatched: 0, tagsAssigned: 0, warnings: [] },
    metadataConflictCount: 0,
    references: {
      referencesCreated: ref.includes('good') ? 1 : 0,
      referencesUpdated: 0,
      referencesNoop: 0,
      referenceEdgesCreated: ref.includes('good') ? 1 : 0,
      referenceEdgesUpdated: 0,
      referenceEdgesNoop: 0,
    },
    durationMs: 0,
  };
}

function taxonomyConfig(): ResolvedConfig {
  return {
    ...testConfig(),
    extensions: {
      global: {
        taxonomy: {
          categories: [{ id: 'cat-1', name: 'Work' }],
          topics: [{ id: 'topic-1', name: 'Email', categoryId: 'cat-1' }],
          tags: [{ id: 'tag-1', name: 'project', topicIds: ['topic-1'] }],
        },
      },
    },
  };
}

describe('createEmailVectorSpec', () => {
  it('produces message locators for thread excerpts', async () => {
    const vector = createEmailVectorSpec({
      thread: {
        threadId: 'email:thread:msg-a',
        rootMessageId: 'msg-a',
        subject: 'Project status',
        participants: ['Alice', 'Bob'],
        messages: [
          {
            filePath: '/tmp/a.eml',
            messageId: 'msg-a',
            threadId: 'email:thread:msg-a',
            rootMessageId: 'msg-a',
            subject: 'Project status',
            from: 'Alice',
            to: ['Bob'],
            cc: [],
            date: '2026-05-22T09:00:00.000Z',
            bodyText: 'Initial note',
            references: [],
            attachments: [],
          },
        ],
      },
    });

    const result = await vector.ingestAndDecode({ ref: '/tmp/a.eml' }, runtimeContext);
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.raw.canonicalId).toBe('email:thread:msg-a');
    expect(result.value.raw.resourceMetadata).toMatchObject({
      subject: 'Project status',
      rootMessageId: 'msg-a',
      messageIds: ['msg-a'],
      participants: ['Alice', 'Bob'],
      messageCount: 1,
    });
    expect(result.value.segments).toHaveLength(1);
    expect(result.value.segments[0]!.locator).toEqual({ kind: 'message', messageId: 'msg-a', charStart: 0, charEnd: 'Initial note'.length });
    expect(result.value.segments[0]!.text).toBe('Initial note');
  });

  it('uses an injected clock for durable provenance timestamps', async () => {
    const thread = {
      threadId: 'email:thread:msg-a',
      rootMessageId: 'msg-a',
      subject: 'Project status',
      participants: ['Alice', 'Bob'],
      messages: [
        {
          filePath: '/tmp/a.eml',
          messageId: 'msg-a',
          threadId: 'email:thread:msg-a',
          rootMessageId: 'msg-a',
          subject: 'Project status',
          from: 'Alice',
          to: ['Bob'],
          cc: [],
          date: '2026-05-22T09:00:00.000Z',
          bodyText: 'Initial note',
          references: [],
          attachments: [],
        },
      ],
    };
    const vector = createEmailVectorSpec({ thread });
    const first = await vector.ingestAndDecode({ ref: '/tmp/a.eml' }, runtimeContext);
    const second = await vector.ingestAndDecode({ ref: '/tmp/a.eml' }, runtimeContext);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error('expected ingests to succeed');
    expect(first.value.raw.provenance.ingestedAt).toBe('2026-05-25T12:34:56.000Z');
    expect(second.value.raw.provenance).toEqual(first.value.raw.provenance);
  });
});

describe('runEmailBatch', () => {
  it('processes a directory of .eml files into a single reparented thread', async () => {
    const dir = await makeEmailDir();
    await writeEmailFile(dir, 'leaf.eml', [
      'Message-ID: <msg-c>',
      'Date: Thu, 22 May 2026 10:00:00 +0000',
      'From: Carol <carol@example.com>',
      'To: Bob <bob@example.com>',
      'Subject: Re: Project status',
      'In-Reply-To: <msg-b>',
      '',
      'Leaf body',
    ].join('\r\n'));

    await writeEmailFile(dir, 'parent.eml', [
      'Message-ID: <msg-b>',
      'Date: Thu, 22 May 2026 11:00:00 +0000',
      'From: Bob <bob@example.com>',
      'To: Alice <alice@example.com>',
      'Subject: Re: Project status',
      'References: <msg-a>',
      'In-Reply-To: <msg-a>',
      '',
      'Parent body',
    ].join('\r\n'));

    const result = await runEmailBatch(dir, undefined, services());
    expect(result.sourceId).toBe('email');
    expect(result.outcome).toBe('completed');
    expect(result.completed).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.errors).toEqual([]);
    expect(result.threads).toBe(1);
    expect(result.summaries[0]!.canonicalId).toBe('email:thread:msg-a');
    expect(result.summaries[0]!.segmentCount).toBe(2);
  });

  it('surfaces partial thread failures without aborting the email batch', async () => {
    const dir = await makeEmailDir();
    const goodFile = await writeEmailFile(dir, 'good.eml', [
      'Message-ID: <good-msg>',
      'Date: Thu, 22 May 2026 09:00:00 +0000',
      'From: Alice <alice@example.com>',
      'To: Bob <bob@example.com>',
      'Subject: Good thread',
      '',
      'Good body',
    ].join('\r\n'));
    const badFile = await writeEmailFile(dir, 'bad.eml', [
      'Message-ID: <bad-msg>',
      'Date: Thu, 22 May 2026 10:00:00 +0000',
      'From: Carol <carol@example.com>',
      'To: Dave <dave@example.com>',
      'Subject: Bad thread',
      '',
      'Bad body',
    ].join('\r\n'));

    const store = new InMemoryStore();
    const result = await runEmailBatchWithContext(dir, undefined, {
      store,
      clock: fixedClock,
      async runVector(_vector, input) {
        if (input.ref === badFile) {
          return { ok: false, error: new Error('thread export failed') };
        }
        return { ok: true, value: reportFor(input.ref) };
      },
    });

    expect(result.outcome).toBe('completed_with_errors');
    expect(result.completed).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.summaries).toHaveLength(1);
    expect(result.errors).toEqual([{
      item: badFile,
      message: 'thread export failed',
      timestamp: '2026-05-25T12:34:56.000Z',
    }]);
    expect(result.references).toMatchObject({ referencesCreated: 1, referenceEdgesCreated: 1 });
    expect(result.warnings).toContain(`${badFile}: thread export failed`);
    expect(result.summaries[0]?.ref).toBe(goodFile);
    await store.close();
  });

  it('classifies email threads through the shared config-seeded registry', async () => {
    const dir = await makeEmailDir();
    await writeEmailFile(dir, 'project.eml', [
      'Message-ID: <msg-a>',
      'Date: Thu, 22 May 2026 09:00:00 +0000',
      'From: Alice <alice@example.com>',
      'To: Bob <bob@example.com>',
      'Subject: Project status',
      '',
      'The project status update is ready for review.',
    ].join('\r\n'));

    const store = new InMemoryStore();
    const result = await runEmailBatch(dir, undefined, { config: taxonomyConfig(), llm: fakeLlm(), store, clock: fixedClock });
    expect(result.summaries[0]?.classification).toMatchObject({
      status: 'completed',
      tagsMatched: 1,
      tagsAssigned: 1,
    });
    const resource = await store.getNode('email:thread:msg-a');
    expect(resource.ok).toBe(true);
    if (!resource.ok) throw resource.error;
    expect(resource.value?.metadata?.['taxonomyAssignments']).toEqual([{
      nodeId: 'email:thread:msg-a',
      tagId: 'tag-1',
      confidence: 0.7,
      source: 'automatic',
      assignedAt: '2026-05-25T12:34:56.000Z',
      assignedBy: 'praecis-keyword-classifier',
    }]);
    await store.close();
  });
});
