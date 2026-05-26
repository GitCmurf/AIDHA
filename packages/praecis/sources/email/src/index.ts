// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { simpleParser } from 'mailparser';
import type { ParsedMail } from 'mailparser';
import type {
  DecodeInput,
  DecodeOutput,
  ExtractionContext,
  IContextProvider,
  IDecodeStrategy,
  IIngestor,
  IngestInput,
  MediaSegment,
  RawSource,
  Result,
  Locator,
  ClassificationResult,
  PipelineServices,
  RunReport,
  ComposedVector,
  BatchOutcome,
  Clock,
} from '@aidha/praecis-core';
import { composeVector, createConfiguredPipelineServices, createIngestionRuntimeFromServices, normalizeText, runBatch } from '@aidha/praecis-core';
import { extractTextFromHtml } from '@aidha/praecis-decode-text';
import type { ResolvedConfig, SourceRegistration } from '@aidha/config';
import type { GraphStore } from '@aidha/graph-backend';

interface EmailAddressValue {
  readonly name?: string;
  readonly address?: string;
}

interface EmailAddressObject {
  readonly value?: readonly EmailAddressValue[];
}

interface EmailAttachment {
  readonly filename?: string;
  readonly contentType?: string;
  readonly size: number;
}

interface EmailParsedMail {
  readonly messageId?: string | null;
  readonly references?: string | readonly string[] | null;
  readonly inReplyTo?: string | null;
  readonly subject?: string | null;
  readonly from?: EmailAddressObject | null;
  readonly sender?: EmailAddressObject | null;
  readonly replyTo?: EmailAddressObject | null;
  readonly to?: EmailAddressObject | null;
  readonly cc?: EmailAddressObject | null;
  readonly date?: Date | null;
  readonly text?: string | null;
  readonly html?: string | null;
  readonly attachments: readonly EmailAttachment[];
}

export interface EmailAttachmentSummary {
  readonly filename?: string;
  readonly contentType?: string;
  readonly size: number;
}

export interface ParsedEmailMessage {
  readonly filePath: string;
  readonly messageId: string;
  readonly threadId: string;
  readonly rootMessageId: string;
  readonly subject: string;
  readonly from?: string;
  readonly to: readonly string[];
  readonly cc: readonly string[];
  readonly date?: string;
  readonly bodyText: string;
  readonly rawBodyText?: string;
  readonly rawHtml?: string;
  readonly references: readonly string[];
  readonly inReplyTo?: string;
  readonly attachments: readonly EmailAttachmentSummary[];
}

export interface EmailThread {
  readonly threadId: string;
  readonly rootMessageId: string;
  readonly subject: string;
  readonly participants: readonly string[];
  readonly messages: readonly ParsedEmailMessage[];
}

export interface EmailThreadPayload {
  readonly thread: EmailThread;
  readonly uri: string;
  readonly mimeType: string;
}

export interface EmailBatchSummary {
  readonly sourceId: 'email';
  readonly itemCount: number;
  readonly outcome: BatchOutcome;
  readonly completed: number;
  readonly failed: number;
  readonly errors: readonly EmailBatchError[];
  readonly importedFiles: number;
  readonly threads: number;
  readonly summaries: readonly EmailThreadSummary[];
  readonly classification: ClassificationResult;
  readonly metadataConflictCount: number;
  readonly references: RunReport['references'];
  readonly warnings: readonly string[];
  readonly details: {
    readonly importedFiles: number;
    readonly threads: number;
    readonly errors: readonly EmailBatchError[];
  };
}

export interface EmailBatchError {
  readonly item: string;
  readonly message: string;
  readonly timestamp: string;
}

export interface EmailThreadSummary {
  readonly sourceId: 'email';
  readonly ref: string;
  readonly canonicalId: string;
  readonly label?: string;
  readonly segmentCount: number;
  readonly chunkCount: number;
  readonly claimsExtracted: number;
  readonly claimIds: readonly string[];
  readonly claims: readonly {
    readonly text: string;
    readonly excerptIds: readonly string[];
    readonly method?: unknown;
    readonly model?: unknown;
    readonly promptVersion?: unknown;
  }[];
  readonly resourceId: string;
  readonly dedupAction: 'create' | 'merge' | 'corroborate';
  readonly policyRoute: 'cloud' | 'local' | 'disabled';
  readonly classification: ClassificationResult;
  readonly metadataConflictCount: number;
  readonly references: RunReport['references'];
  readonly warnings: readonly string[];
  readonly segments: readonly {
    readonly id: string;
    readonly locator: Locator;
    readonly text?: string;
    readonly label?: string;
  }[];
  readonly chunks: readonly {
    readonly id: string;
    readonly locator: Locator;
    readonly text: string;
    readonly segmentIds: readonly string[];
  }[];
}

export interface EmailIngestOptions {
  readonly readFileFn?: typeof readFile;
}

export interface EmailBatchExecutionContext {
  readonly store: GraphStore;
  readonly clock?: Clock;
  runVector(vector: ComposedVector, input: IngestInput): Promise<Result<RunReport>>;
}

export interface EmailVectorOptions {
  readonly thread: EmailThread;
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function stableId(seed: string): string {
  return sha256Hex(seed).slice(0, 16);
}

function clean(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function normalizeMessageId(value: string | undefined | null): string | undefined {
  const cleaned = clean(value);
  if (!cleaned) return undefined;
  return cleaned.replace(/^<|>$/g, '');
}

function firstHeaderAddress(parsed: EmailParsedMail['from'] | EmailParsedMail['sender'] | EmailParsedMail['replyTo']): string | undefined {
  const value = parsed?.value?.[0];
  if (!value) return undefined;
  return clean(value.name) ?? clean(value.address);
}

function headerAddressList(values: EmailParsedMail['to'] | EmailParsedMail['cc']): string[] {
  return (values?.value ?? [])
    .map((entry: { name?: string; address?: string }) => clean(entry.name) ?? clean(entry.address))
    .filter((value): value is string => Boolean(value));
}

function normalizeHeaderList(headers: string | string[] | undefined): string[] {
  if (!headers) return [];
  return (Array.isArray(headers) ? headers : [headers])
    .map(entry => normalizeMessageId(entry))
    .filter((value): value is string => Boolean(value));
}

export function stripEmailReply(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const kept: string[] = [];
  let inQuotedReply = false;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '');
    const trimmed = line.trim();
    if (!trimmed && !inQuotedReply) {
      kept.push('');
      continue;
    }
    if (/^--\s*$/.test(trimmed) || /^__+$/.test(trimmed)) {
      break;
    }
    if (/^On .+ wrote:$/.test(trimmed) || /^-----Original Message-----$/.test(trimmed)) {
      break;
    }
    if (trimmed.startsWith('>')) {
      inQuotedReply = true;
      continue;
    }
    if (/^(From|Sent|To|Subject):\s+/i.test(trimmed) && inQuotedReply) {
      break;
    }
    kept.push(line);
  }

  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function bodyFromParsedMail(parsed: EmailParsedMail): string {
  const htmlText = clean(typeof parsed.html === 'string' ? extractTextFromHtml(parsed.html).text : undefined);
  const plainText = clean(typeof parsed.text === 'string' ? parsed.text : undefined);
  const rawText = htmlText ?? plainText ?? '';
  return stripEmailReply(rawText);
}

function attachmentSummary(parsed: EmailParsedMail): EmailAttachmentSummary[] {
  return parsed.attachments.map((attachment: EmailAttachment) => ({
    filename: clean(attachment.filename),
    contentType: clean(attachment.contentType),
    size: attachment.size,
  }));
}

function threadRootFromReferences(messageId: string, references: readonly string[], inReplyTo?: string): string {
  return references[0] ?? inReplyTo ?? messageId;
}

function provisionalThreadId(messageId: string): string {
  return `email:thread:${messageId}`;
}

function threadIdForMessage(messageId: string, references: readonly string[], inReplyTo?: string): string {
  return `email:thread:${threadRootFromReferences(messageId, references, inReplyTo)}`;
}

function messageLocator(messageId: string, bodyText: string): Locator {
  return {
    kind: 'message',
    messageId,
    charStart: 0,
    charEnd: bodyText.length,
  };
}

export async function parseEmailFile(filePath: string, readFileFn: typeof readFile = readFile): Promise<ParsedEmailMessage> {
  const buffer = await readFileFn(filePath);
  const parsed = await simpleParser(buffer);

  const messageId = normalizeMessageId(parsed.messageId) ?? stableId(filePath);
  const references = normalizeHeaderList(parsed.references as string[] | string | undefined);
  const inReplyTo = normalizeMessageId(parsed.inReplyTo as string | undefined);
  const threadId = threadIdForMessage(messageId, references, inReplyTo);
  const bodyText = bodyFromParsedMail(parsed);
  const subject = clean(parsed.subject) ?? clean(bodyText.split('\n', 1)[0]) ?? 'Untitled email';
  const attachments = attachmentSummary(parsed);

  return {
    filePath,
    messageId,
    threadId,
    rootMessageId: threadRootFromReferences(messageId, references, inReplyTo),
    subject,
    from: firstHeaderAddress(parsed.from),
    to: headerAddressList(parsed.to),
    cc: headerAddressList(parsed.cc),
    date: parsed.date?.toISOString(),
    bodyText,
    rawBodyText: clean(typeof parsed.text === 'string' ? parsed.text : undefined),
    rawHtml: clean(typeof parsed.html === 'string' ? parsed.html : undefined),
    references,
    inReplyTo,
    attachments,
  };
}

async function collectEmailFiles(ref: string): Promise<string[]> {
  const entries = await stat(ref);
  if (!entries.isDirectory()) {
    return [ref];
  }

  const files: string[] = [];
  const stack = [ref];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const currentEntries = await readdir(current, { withFileTypes: true });
    for (const entry of currentEntries) {
      const child = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(child);
      } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.eml') {
        files.push(child);
      }
    }
  }
  return files.sort();
}

export async function parseEmailInputs(ref: string, readFileFn: typeof readFile = readFile): Promise<ParsedEmailMessage[]> {
  const files = await collectEmailFiles(ref);
  const messages: ParsedEmailMessage[] = [];
  for (const filePath of files) {
    messages.push(await parseEmailFile(filePath, readFileFn));
  }
  return messages;
}

function mergeThreadMessages(existing: EmailThread, incoming: ParsedEmailMessage): EmailThread {
  const messages = [...existing.messages, incoming].sort((a, b) => {
    const left = a.date ?? a.filePath;
    const right = b.date ?? b.filePath;
    return left.localeCompare(right);
  });
  const participants = Array.from(new Set([
    ...existing.participants,
    ...(incoming.from ? [incoming.from] : []),
    ...incoming.to,
    ...incoming.cc,
  ])).sort();
  return {
    threadId: incoming.threadId,
    rootMessageId: incoming.rootMessageId,
    subject: existing.subject || incoming.subject,
    participants,
    messages,
  };
}

function createThread(messages: readonly ParsedEmailMessage[]): EmailThread {
  const first = messages[0]!;
  const participants = Array.from(new Set([
    ...(first.from ? [first.from] : []),
    ...first.to,
    ...first.cc,
  ])).sort();
  return {
    threadId: first.threadId,
    rootMessageId: first.rootMessageId,
    subject: first.subject,
    participants,
    messages: [...messages],
  };
}

export function groupEmailMessages(messages: readonly ParsedEmailMessage[]): EmailThread[] {
  const threads = new Map<string, EmailThread>();

  for (const message of messages) {
    const finalThreadId = message.threadId;
    const aliasThreadId = provisionalThreadId(message.messageId);

    if (aliasThreadId !== finalThreadId && threads.has(aliasThreadId)) {
      const aliased = threads.get(aliasThreadId)!;
      threads.delete(aliasThreadId);
      const merged = mergeThreadMessages({
        ...aliased,
        threadId: finalThreadId,
        rootMessageId: message.rootMessageId,
      }, message);
      threads.set(finalThreadId, merged);
      continue;
    }

    const existing = threads.get(finalThreadId);
    if (existing) {
      threads.set(finalThreadId, mergeThreadMessages(existing, message));
      continue;
    }

    threads.set(finalThreadId, createThread([message]));
  }

  return Array.from(threads.values());
}

function emailThreadResourceMetadata(thread: EmailThread): Record<string, unknown> {
  return {
    subject: thread.subject,
    rootMessageId: thread.rootMessageId,
    messageIds: thread.messages.map(message => message.messageId),
    participants: [...thread.participants],
    messageCount: thread.messages.length,
  };
}

class EmailContextProvider implements IContextProvider {
  constructor(private readonly thread: EmailThread) {}

  async build(_raw: RawSource, _config: ResolvedConfig): Promise<ExtractionContext> {
    return {
      sourceSummary: normalizeText(this.thread.subject),
      chunkingHints: ['highlight'],
    };
  }
}

class EmailIngestor implements IIngestor<EmailThreadPayload> {
  readonly sourceId = 'email';

  constructor(private readonly thread: EmailThread) {}

  async acquire(_input: IngestInput): Promise<Result<RawSource & { payload: EmailThreadPayload }>> {
    return {
      ok: true,
      value: {
        canonicalId: this.thread.threadId,
        dedupKeys: [
          this.thread.threadId,
          `email:message:${this.thread.rootMessageId}`,
          ...this.thread.messages.map(message => `email:message:${message.messageId}`),
        ],
        sourceType: 'email',
        sensitivity: 'confidential',
        provenance: {
          sourceUri: this.thread.messages[0]?.filePath,
          ingestedAt: new Date().toISOString(),
          sourceType: 'email',
        },
        resourceMetadata: emailThreadResourceMetadata(this.thread),
        payload: {
          thread: this.thread,
          uri: this.thread.messages[0]?.filePath ?? this.thread.threadId,
          mimeType: 'message/rfc822',
        },
        label: this.thread.subject,
      },
    };
  }
}

class EmailDecodeStrategy implements IDecodeStrategy {
  readonly name = 'text-extract:email';

  constructor(private readonly thread: EmailThread) {}

  async decode(input: DecodeInput): Promise<Result<DecodeOutput>> {
    const payload = input.raw.payload as EmailThreadPayload | undefined;
    if (!payload || payload.thread.threadId !== this.thread.threadId) {
      return { ok: false, error: new Error('Email decode expected a matching thread payload') };
    }

    return {
      ok: true,
      value: {
        segments: this.thread.messages.map((message, index) => ({
          id: stableId(`${this.thread.threadId}:${message.messageId}:${index}`),
          locator: messageLocator(message.messageId, message.bodyText),
          text: message.bodyText,
          label: message.from ?? message.subject,
        })),
        warnings: [],
      },
    };
  }
}

export const EmailSourceRegistration: SourceRegistration = {
  sourceId: 'email',
  validateActiveSourceConfig: (value: unknown) => value,
};

export function createEmailVectorSpec(thread: EmailThread) {
  return composeVector({
    sourceId: 'email',
    sensitivity: 'confidential',
    ingestor: new EmailIngestor(thread),
    decode: [new EmailDecodeStrategy(thread)],
    context: new EmailContextProvider(thread),
    chunking: 'highlight',
    registration: EmailSourceRegistration,
  });
}

function aggregateClassification(summaries: readonly EmailThreadSummary[]): ClassificationResult {
  const enabled = summaries.filter(summary => summary.classification.status === 'completed');
  return {
    status: enabled.length > 0 ? 'completed' : 'disabled',
    tagsMatched: summaries.reduce((sum, summary) => sum + summary.classification.tagsMatched, 0),
    tagsAssigned: summaries.reduce((sum, summary) => sum + summary.classification.tagsAssigned, 0),
    warnings: summaries.flatMap(summary => summary.classification.warnings),
  };
}

function aggregateReferences(summaries: readonly EmailThreadSummary[]): RunReport['references'] {
  return {
    referencesCreated: summaries.reduce((sum, summary) => sum + summary.references.referencesCreated, 0),
    referencesUpdated: summaries.reduce((sum, summary) => sum + summary.references.referencesUpdated, 0),
    referencesNoop: summaries.reduce((sum, summary) => sum + summary.references.referencesNoop, 0),
    referenceEdgesCreated: summaries.reduce((sum, summary) => sum + summary.references.referenceEdgesCreated, 0),
    referenceEdgesUpdated: summaries.reduce((sum, summary) => sum + summary.references.referenceEdgesUpdated, 0),
    referenceEdgesNoop: summaries.reduce((sum, summary) => sum + summary.references.referenceEdgesNoop, 0),
  };
}

export async function runEmailBatch(
  ref: string,
  readFileFn: typeof readFile = readFile,
  serviceOverrides: Partial<PipelineServices> = {},
): Promise<EmailBatchSummary> {
  const servicesResult = await createConfiguredPipelineServices(serviceOverrides);
  if (!servicesResult.ok) {
    throw servicesResult.error;
  }
  const services = servicesResult.value;
  const runtime = createIngestionRuntimeFromServices(services, {
    store: serviceOverrides.store === undefined,
    taxonomyRegistry: serviceOverrides.taxonomyRegistry === undefined,
  });
  try {
    return await runEmailBatchWithContext(ref, readFileFn, {
      store: services.store,
      clock: services.clock,
      runVector: (vector, input) => runtime.runVector(vector, input),
    });
  } finally {
    await runtime.close();
  }
}

export async function runEmailBatchWithContext(
  ref: string,
  readFileFn: typeof readFile = readFile,
  context: EmailBatchExecutionContext,
): Promise<EmailBatchSummary> {
  const messages = await parseEmailInputs(ref, readFileFn);
  const threads = groupEmailMessages(messages);
  const batch = await runBatch({
    items: threads,
    clock: context.clock ?? { now: () => new Date() },
    async runItem(thread) {
      const vector = createEmailVectorSpec(thread);
      const threadRef = thread.messages.map(message => message.filePath).join(', ');
      const runEmailThread = async () => {
        const run = await context.runVector(vector, { ref: threadRef });
        if (!run.ok) {
          return run;
        }
        const reparent = await reparentEmailThread(context.store, thread, { skipTransaction: true });
        if (!reparent.ok) {
          return { ok: false as const, error: reparent.error };
        }
        return run;
      };
      const run = context.store.runInTransaction
        ? await context.store.runInTransaction(runEmailThread)
        : await runEmailThread();
      if (!run.ok) {
        return run;
      }
      const summary: EmailThreadSummary & { readonly report: RunReport } = {
        sourceId: 'email' as const,
        ref: threadRef,
        canonicalId: run.value.canonicalId,
        resourceId: run.value.resourceId,
        label: thread.subject,
        segmentCount: run.value.segmentCount,
        chunkCount: run.value.chunkCount,
        claimsExtracted: run.value.claimsExtracted,
        claimIds: run.value.claimIds,
        claims: run.value.claims.map(claim => ({
          text: claim.text,
          excerptIds: claim.excerptIds,
          method: claim.metadata?.['method'],
          model: claim.metadata?.['model'],
          promptVersion: claim.metadata?.['promptVersion'],
        })),
        dedupAction: run.value.dedupAction,
        policyRoute: run.value.policyRoute,
        classification: run.value.classification,
        metadataConflictCount: run.value.metadataConflictCount,
        references: run.value.references,
        warnings: run.value.warnings,
        segments: run.value.segments.map(segment => ({
          id: segment.id,
          locator: segment.locator,
          text: segment.text,
          label: segment.label,
        })),
        chunks: run.value.chunks.map(chunk => ({
          id: chunk.id,
          locator: chunk.locator,
          text: chunk.text,
          segmentIds: chunk.segments.map(segment => segment.id),
        })),
        report: run.value,
      };
      return { ok: true as const, value: summary };
    },
  });
  const summaries = batch.successes.map(success => success.value);
  const errors = batch.failures.map(failure => ({
    item: failure.item.messages.map(message => message.filePath).join(', '),
    message: failure.message,
    timestamp: failure.timestamp,
  }));

  return {
    sourceId: 'email',
    itemCount: threads.length,
    outcome: batch.outcome,
    completed: batch.completed,
    failed: batch.failed,
    errors,
    importedFiles: messages.length,
    threads: threads.length,
    summaries,
    classification: batch.classification,
    metadataConflictCount: batch.metadataConflictCount,
    references: batch.references,
    warnings: [...batch.warnings, ...errors.map(error => `${error.item}: ${error.message}`)],
    details: {
      importedFiles: messages.length,
      threads: threads.length,
      errors,
    },
  };
}

export interface ReparentEmailThreadOptions {
  readonly skipTransaction?: boolean;
}

export async function reparentEmailThread(
  store: GraphStore,
  thread: EmailThread,
  options: ReparentEmailThreadOptions = {},
): Promise<Result<void>> {
  const apply = async (): Promise<Result<void>> => {
    const finalThreadId = thread.threadId;
    const provisionalId = provisionalThreadId(thread.messages[0]?.messageId ?? thread.rootMessageId);

    if (provisionalId === finalThreadId) {
      return { ok: true, value: undefined };
    }

    const provisionalResult = await store.getNode(provisionalId);
    if (!provisionalResult.ok) return provisionalResult;
    const provisionalNode = provisionalResult.value;

    const rootNodeResult = await store.getNode(finalThreadId);
    if (!rootNodeResult.ok) return rootNodeResult;
    const rootNode = rootNodeResult.value;

    const mergedDedupKeys = Array.from(new Set([
      ...(rootNode?.metadata && Array.isArray((rootNode.metadata as Record<string, unknown>)['dedupKeys']) ? (rootNode.metadata as Record<string, unknown>)['dedupKeys'] as string[] : []),
      ...(provisionalNode?.metadata && Array.isArray((provisionalNode.metadata as Record<string, unknown>)['dedupKeys']) ? (provisionalNode.metadata as Record<string, unknown>)['dedupKeys'] as string[] : []),
      finalThreadId,
      provisionalId,
    ]));

    await store.upsertNode('Resource', finalThreadId, {
      label: thread.subject,
      metadata: {
        canonicalId: finalThreadId,
        sourceType: 'email',
        dedupKeys: mergedDedupKeys,
          provenances: [
            ...(rootNode?.metadata && Array.isArray((rootNode.metadata as Record<string, unknown>)['provenances']) ? (rootNode.metadata as Record<string, unknown>)['provenances'] as unknown[] : []),
            ...(provisionalNode?.metadata && Array.isArray((provisionalNode.metadata as Record<string, unknown>)['provenances']) ? (provisionalNode.metadata as Record<string, unknown>)['provenances'] as unknown[] : []),
          ],
          ...emailThreadResourceMetadata(thread),
        },
      });

    const existingEdges = await store.getEdges({ subject: provisionalId, predicate: 'resourceHasExcerpt' });
    if (!existingEdges.ok) return existingEdges;
    for (const edge of existingEdges.value.items) {
      const excerptId = edge.object;
      await store.upsertNode('Excerpt', excerptId, {
        label: thread.subject,
        metadata: {
          resourceId: finalThreadId,
          locator: edge.metadata['locator'],
          sequence: edge.metadata['sequence'],
        },
      });
      await store.upsertEdge(finalThreadId, 'resourceHasExcerpt', excerptId, { metadata: { ...edge.metadata } }, { detectNoop: true });
    }

    if (provisionalNode) {
      await store.deleteNode(provisionalId, { cascade: true });
    }

    return { ok: true, value: undefined };
  };

  if (!options.skipTransaction && store.runInTransaction) {
    return store.runInTransaction(apply);
  }
  return apply();
}
