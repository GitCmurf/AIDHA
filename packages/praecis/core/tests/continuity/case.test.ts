import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import { SQLiteStore } from '@aidha/graph-backend';
import { CaptureEvent, captureCase, renderContinuityMarkdown, showCase, updateCase } from '../../src/continuity/index.js';
import { capture } from './fixture.js';

function cloneCapture(): z.input<typeof CaptureEvent> {
  return structuredClone(capture) as z.input<typeof CaptureEvent>;
}

it('preserves unknown dates and explicitly stated responsibility facts', async () => {
  const store = SQLiteStore.createInMemory();
  try {
    const input = cloneCapture();
    input.activities[1] = { ...input.activities[1]!, date: null, dateBasis: 'unknown' };
    input.facts.push({
      id: 'pack-owner', activityId: 'pack', key: 'responsible',
      value: 'Parent packs the instrument', basis: 'supplied', appliesOn: null,
    });

    await captureCase(store, 'friday', input);
    const view = await showCase(store, 'friday', '2026-10-02');

    expect(view.activities[1]).toEqual(input.activities[1]);
    expect(view.facts).toContainEqual({ ...input.facts[2], sourceId: input.source.id });
    expect(view.history[0]?.event.source.text).toBe(input.source.text);
  } finally {
    await store.close();
  }
});

it('rejects date-basis and fact-date contradictions before writing', async () => {
  const store = SQLiteStore.createInMemory();
  try {
    const unknownDate = cloneCapture();
    unknownDate.activities[1] = { ...unknownDate.activities[1]!, date: null, dateBasis: 'supplied' };
    expect(() => captureCase(store, 'bad-basis', unknownDate)).toThrow();

    const mismatchedFact = cloneCapture();
    mismatchedFact.facts[0] = { ...mismatchedFact.facts[0]!, appliesOn: '2026-10-03' };
    await expect(captureCase(store, 'bad-fact-date', mismatchedFact)).rejects.toThrow(/fact date differs/i);

    const snapshot = await store.exportSnapshot({ scope: 'full' });
    if (!snapshot.ok) throw snapshot.error;
    expect(snapshot.value.nodes).toEqual([]);
  } finally {
    await store.close();
  }
});

it.each([
  ['duplicate record IDs', (input: ReturnType<typeof cloneCapture>) => {
    input.questions[0] = { ...input.questions[0]!, id: input.activities[0]!.id };
  }, /duplicate record ID/i],
  ['dangling prerequisites', (input: ReturnType<typeof cloneCapture>) => {
    input.activities[0] = { ...input.activities[0]!, prerequisites: ['missing'] };
  }, /unknown activity reference/i],
  ['dependency cycles', (input: ReturnType<typeof cloneCapture>) => {
    input.activities[0] = { ...input.activities[0]!, prerequisites: ['orchestra'] };
    input.activities[2] = { ...input.activities[2]!, prerequisites: ['robotics'] };
  }, /dependency cycle/i],
  ['conflicting facts for one activity key', (input: ReturnType<typeof cloneCapture>) => {
    input.facts.push({ ...input.facts[0]!, id: 'second-venue' });
  }, /conflicting fact/i],
  ['dangling fact activities', (input: ReturnType<typeof cloneCapture>) => {
    input.facts[0] = { ...input.facts[0]!, activityId: 'missing' };
  }, /unknown activity reference/i],
  ['dangling decision activities', (input: ReturnType<typeof cloneCapture>) => {
    input.decisions[0] = { ...input.decisions[0]!, activityIds: ['missing'] };
  }, /unknown activity reference/i],
  ['dangling question activities', (input: ReturnType<typeof cloneCapture>) => {
    input.questions[0] = { ...input.questions[0]!, activityIds: ['missing'] };
  }, /unknown activity reference/i],
  ['unknown schema fields', (input: ReturnType<typeof cloneCapture>) => {
    Object.assign(input, { unexpected: true });
  }, /unrecognized key/i],
])('rejects %s without writing any graph state', async (_case, mutate, expectedError) => {
  const store = SQLiteStore.createInMemory();
  try {
    const input = cloneCapture();
    mutate(input);
    await expect(Promise.resolve().then(() => captureCase(store, 'invalid', input))).rejects.toThrow(expectedError);
    const snapshot = await store.exportSnapshot({ scope: 'full' });
    if (!snapshot.ok) throw snapshot.error;
    expect(snapshot.value.nodes).toEqual([]);
  } finally {
    await store.close();
  }
});

it('rejects duplicate source IDs, intent changes, and unknown-fact corrections without mutation', async () => {
  const store = SQLiteStore.createInMemory();
  try {
    await captureCase(store, 'friday', capture);
    const before = await store.exportSnapshot({ scope: 'full' });
    const duplicateSource = {
      kind: 'correct', eventId: 'duplicate-source-event', expectedRevision: 1,
      source: { ...capture.source, text: 'Different source, same ID.' },
      interpreter: 'test-fixture', factId: 'venue', value: 'East Hall', basis: 'supplied',
    };
    await expect(updateCase(store, 'friday', duplicateSource)).rejects.toThrow(/source ID collision/i);

    const changedIntent = {
      ...duplicateSource, eventId: 'intent-change', expectedRevision: 1,
      source: { ...capture.source, id: 'new-source', intent: 'operational' },
    };
    await expect(updateCase(store, 'friday', changedIntent)).rejects.toThrow(/intent cannot change/i);

    const unknownFact = {
      ...duplicateSource, eventId: 'unknown-fact', expectedRevision: 1,
      source: { ...capture.source, id: 'unknown-fact-source' }, factId: 'missing',
    };
    await expect(updateCase(store, 'friday', unknownFact)).rejects.toThrow(/unknown fact/i);
    expect(await store.exportSnapshot({ scope: 'full' })).toEqual(before);
  } finally {
    await store.close();
  }
});

it('refuses to write through a store without transactions', async () => {
  const nonTransactional = { runInTransaction: undefined } as unknown as Parameters<typeof captureCase>[0];
  await expect(Promise.resolve().then(() => captureCase(nonTransactional, 'friday', capture)))
    .rejects.toThrow(/transactional store/i);
});

it('escapes source-derived Markdown while keeping unknown dates explicit', async () => {
  const store = SQLiteStore.createInMemory();
  try {
    const input = cloneCapture();
    input.title = '<script>*Plan*</script>';
    input.activities[1] = { ...input.activities[1]!, date: null, dateBasis: 'unknown', label: '`Pack` [instrument]' };
    input.facts[0] = { ...input.facts[0]!, key: 'location_*', value: '<b>West</b>' };
    input.facts.push({
      id: 'pack-owner', activityId: 'pack', key: 'responsible',
      value: 'Parent *packs* the instrument', basis: 'supplied', appliesOn: null,
    });
    input.questions[0] = { ...input.questions[0]!, question: '[Prep](javascript:bad)' };

    await captureCase(store, 'markdown', input);
    const view = await showCase(store, 'markdown', '2026-10-02');
    const markdown = renderContinuityMarkdown(view);

    expect(markdown).toContain('# &lt;script&gt;\\*Plan\\*&lt;/script&gt;');
    expect(markdown).toContain('\\`Pack\\`');
    expect(markdown).toContain('date unknown');
    expect(markdown).toContain('&lt;b&gt;West&lt;/b&gt;');
    expect(markdown).toContain('\\[Prep\\]');
  } finally {
    await store.close();
  }
});

it('does not infer responsibility from participation', async () => {
  const store = SQLiteStore.createInMemory();
  try {
    await captureCase(store, 'no-inference', capture);
    const view = await showCase(store, 'no-inference', '2026-10-02');
    expect(view.activities[1]?.participants).toContain('Parent');
    expect(view.facts.some(fact => fact.key === 'responsible')).toBe(false);
  } finally {
    await store.close();
  }
});

it('corrects one fact while preserving provenance, unrelated facts, and idempotent history', async () => {
  const store = SQLiteStore.createInMemory();
  try {
    await captureCase(store, 'friday', capture);
    const correction = {
      kind: 'correct', eventId: 'correction-1', expectedRevision: 1,
      source: { ...capture.source, id: 'correction-source', text: 'The venue is East Hall.' },
      interpreter: 'test-fixture', factId: 'venue', value: 'East Hall', basis: 'supplied',
    };
    expect(await updateCase(store, 'friday', correction)).toEqual({ caseId: 'friday', revision: 2, replayed: false });
    const beforeReplay = await showCase(store, 'friday', '2026-10-02');
    expect(beforeReplay.facts).toEqual([
      { ...capture.facts[0], value: 'East Hall', basis: 'supplied', sourceId: correction.source.id },
      { ...capture.facts[1], sourceId: capture.source.id },
    ]);
    expect(beforeReplay.sources).toEqual([capture.source, correction.source]);
    expect(beforeReplay.history.map(item => item.event)).toEqual([capture, correction]);
    expect(await updateCase(store, 'friday', correction)).toEqual({ caseId: 'friday', revision: 2, replayed: true });
    await expect(updateCase(store, 'friday', { ...correction, value: 'South Hall' })).rejects.toThrow(/event id collision/i);
    await expect(updateCase(store, 'friday', {
      ...correction, eventId: 'stale', expectedRevision: 1,
      source: { ...correction.source, id: 'stale-source' },
    })).rejects.toThrow(/revision conflict/i);
    expect(await showCase(store, 'friday', '2026-10-02')).toEqual(beforeReplay);
  } finally {
    await store.close();
  }
});

it('rolls back a failed correction write', async () => {
  const store = SQLiteStore.createInMemory();
  try {
    await captureCase(store, 'friday', capture);
    const before = await store.exportSnapshot({ scope: 'full' });
    const correction = {
      kind: 'correct', eventId: 'failed-correction', expectedRevision: 1,
      source: { ...capture.source, id: 'failed-source', text: 'Venue is East Hall.' },
      interpreter: 'test-fixture', factId: 'venue', value: 'East Hall', basis: 'supplied',
    };
    const upsert = store.upsertNode.bind(store);
    const spy = vi.spyOn(store, 'upsertNode').mockImplementationOnce(async (...args) => {
      await upsert(...args);
      return { ok: false, error: new Error('injected storage failure') };
    });
    await expect(updateCase(store, 'friday', correction)).rejects.toThrow('injected storage failure');
    spy.mockRestore();
    expect(await store.exportSnapshot({ scope: 'full' })).toEqual(before);
  } finally {
    await store.close();
  }
});

it('serializes competing corrections against one expected revision', async () => {
  const store = SQLiteStore.createInMemory();
  try {
    await captureCase(store, 'friday', capture);
    const corrections = ['East Hall', 'South Hall'].map((value, index) => ({
      kind: 'correct', eventId: `writer-${index}`, expectedRevision: 1,
      source: { ...capture.source, id: `writer-source-${index}`, text: `Venue is ${value}.` },
      interpreter: 'test-fixture', factId: 'venue', value, basis: 'supplied',
    }));
    const results = await Promise.allSettled(corrections.map(event => updateCase(store, 'friday', event)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    const view = await showCase(store, 'friday', '2026-10-02');
    expect(view.revision).toBe(2);
    expect(['East Hall', 'South Hall']).toContain(view.facts[0]?.value);
    expect(view.facts[1]).toEqual({ ...capture.facts[1], sourceId: capture.source.id });
  } finally {
    await store.close();
  }
});

it('rejects a Resource aggregate copied under a different case ID without changing the graph', async () => {
  const store = SQLiteStore.createInMemory();
  try {
    await captureCase(store, 'friday', capture);
    const original = await store.getNode('continuity:friday');
    if (!original.ok || !original.value) throw new Error('Captured Resource is missing');
    await store.upsertNode('Resource', 'continuity:other', {
      label: 'Copied case', metadata: { continuity: original.value.metadata['continuity'] },
    });
    const seeded = await store.exportSnapshot({ scope: 'full' });
    const correction = {
      kind: 'correct', eventId: 'other-correction', expectedRevision: 1,
      source: { ...capture.source, id: 'other-source' },
      interpreter: 'test-fixture', factId: 'venue', value: 'East Hall', basis: 'supplied',
    };

    await expect(showCase(store, 'other', '2026-10-02')).rejects.toThrow(/case identity/i);
    await expect(updateCase(store, 'other', correction)).rejects.toThrow(/case identity/i);
    expect(await store.exportSnapshot({ scope: 'full' })).toEqual(seeded);
  } finally {
    await store.close();
  }
});

it('rejects a non-Resource node at a continuity ID without changing it', async () => {
  const store = SQLiteStore.createInMemory();
  try {
    await captureCase(store, 'friday', capture);
    const original = await store.getNode('continuity:friday');
    if (!original.ok || !original.value) throw new Error('Captured Resource is missing');
    await store.upsertNode('TopicTag', 'continuity:other', {
      label: 'Not a case Resource', metadata: { continuity: original.value.metadata['continuity'] },
    });
    const seeded = await store.exportSnapshot({ scope: 'full' });
    const correction = {
      kind: 'correct', eventId: 'other-correction', expectedRevision: 1,
      source: { ...capture.source, id: 'other-source' },
      interpreter: 'test-fixture', factId: 'venue', value: 'East Hall', basis: 'supplied',
    };

    await expect(showCase(store, 'other', '2026-10-02')).rejects.toThrow(/Resource/i);
    await expect(updateCase(store, 'other', correction)).rejects.toThrow(/Resource/i);
    expect(await store.exportSnapshot({ scope: 'full' })).toEqual(seeded);
  } finally {
    await store.close();
  }
});
