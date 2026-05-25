import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ResolvedConfig } from '@aidha/config';
import type { LlmClient, LlmCompletionRequest, PipelineServices } from '@aidha/praecis-core';
import type { Result } from '@aidha/taxonomy';
import { createEmailVectorSpec, runEmailBatch } from '../src/index.js';

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

describe('createEmailVectorSpec', () => {
  it('produces message locators for thread excerpts', async () => {
    const vector = createEmailVectorSpec({
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
    });

    const result = await vector.ingestAndDecode({ ref: '/tmp/a.eml' });
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
    expect(result.threads).toBe(1);
    expect(result.summaries[0]!.canonicalId).toBe('email:thread:msg-a');
    expect(result.summaries[0]!.segmentCount).toBe(2);
  });
});
