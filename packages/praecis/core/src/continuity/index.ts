// SPDX-License-Identifier: Apache-2.0
import type { GraphStore, Result } from '@aidha/graph-backend';
import { isDeepStrictEqual } from 'node:util';
import { CaptureEvent, ContinuityDate, ContinuityId, StoredCase, UpdateEvent, type ContinuityEvent } from './schema.js';
import { validateCapture } from './validate.js';

export * from './schema.js';

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

const nodeId = (id: string) => `continuity:${ContinuityId.parse(id)}`;

async function load(store: GraphStore, id: string): Promise<StoredCase | null> {
  const node = unwrap(await store.getNode(nodeId(id)));
  if (!node) return null;
  if (node.type !== 'Resource') throw new Error(`Continuity case is not a Resource: ${id}`);
  const state = StoredCase.parse(node.metadata['continuity']);
  if (state.caseId !== id) throw new Error(`Continuity case identity mismatch: requested ${id}, stored ${state.caseId}`);
  return state;
}

export const captureCase = (store: GraphStore, id: string, input: unknown, clock = () => new Date()) =>
  append(store, id, CaptureEvent.parse(input), clock);

export const updateCase = (store: GraphStore, id: string, input: unknown, clock = () => new Date()) =>
  append(store, id, UpdateEvent.parse(input), clock);

async function append(store: GraphStore, id: string, event: ContinuityEvent, clock: () => Date) {
  ContinuityId.parse(id);
  if (!store.runInTransaction) throw new Error('Continuity writes require a transactional store');
  return unwrap(await store.runInTransaction(async () => {
    const existing = await load(store, id);
    const prior = existing?.events.find(item => item.event.eventId === event.eventId);
    if (prior) {
      if (!isDeepStrictEqual(prior.event, event)) throw new Error(`Event ID collision: ${event.eventId}`);
      return { ok: true, value: { caseId: id, revision: existing!.events.length, replayed: true } };
    }
    if ((existing?.events.length ?? 0) !== event.expectedRevision) {
      throw new Error(`Revision conflict: expected ${event.expectedRevision}, current ${existing?.events.length ?? 0}`);
    }
    if (existing?.events.some(item => item.event.source.id === event.source.id)) {
      throw new Error(`Source ID collision: ${event.source.id}`);
    }
    if (existing && event.source.intent !== existing.events[0]!.event.source.intent) {
      throw new Error('Case intent cannot change through an update; capture a separate operational case');
    }
    if (event.kind === 'capture' && existing) throw new Error('Case already exists');
    if (event.kind !== 'capture' && !existing) throw new Error(`Unknown continuity case: ${id}`);
    const state = StoredCase.parse({ schemaVersion: 1, caseId: id,
      events: [...(existing?.events ?? []), { event, recordedAt: clock().toISOString() }],
    });
    const view = project(state);
    const saved = await store.upsertNode('Resource', nodeId(id), {
      label: view.capture.title, metadata: { continuity: state },
    });
    if (!saved.ok) return saved;
    return { ok: true, value: { caseId: id, revision: state.events.length, replayed: false } };
  }));
}

function project(state: StoredCase) {
  const capture = state.events[0]!.event;
  if (capture.kind !== 'capture') throw new Error('Case must begin with capture');
  validateCapture(capture);
  const facts = capture.facts.map(fact => ({ ...fact, sourceId: capture.source.id }));
  for (const { event } of state.events.slice(1)) {
    if (event.kind === 'capture') throw new Error('Case cannot contain another capture');
    const fact = facts.find(item => item.id === event.factId);
    if (!fact) throw new Error(`Unknown fact: ${event.factId}`);
    Object.assign(fact, { value: event.value, basis: event.basis, sourceId: event.source.id });
  }
  return { capture, facts };
}

export async function showCase(store: GraphStore, id: string, on: string) {
  ContinuityDate.parse(on);
  const state = await load(store, id);
  if (!state) throw new Error(`Unknown continuity case: ${id}`);
  const { capture: event, facts } = project(state);
  return {
    caseId: id, revision: state.events.length, title: event.title, on,
    intent: event.source.intent,
    sources: state.events.map(item => item.event.source),
    history: state.events,
    activities: event.activities,
    facts,
    decisions: {
      current: event.decisions.filter(item => item.appliesOn === on),
      historical: event.decisions.filter(item => item.appliesOn !== on),
    },
    questions: event.questions,
  };
}

export { renderContinuityMarkdown } from './render.js';
