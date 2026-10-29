// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { createAgyClient, runAgyProcess, mustStopAgyEvaluation } from './agy-client.mjs';

const selector = 'gemini-3.8-flash-low';
const request = { model: selector, system: 'Extract only supplied evidence.', user: 'Fictional source text',
  responseFormat: { type: 'json_schema', schema: { type: 'object', properties: { units: { type: 'array' } } } } };
const usage = { input_tokens: 12647, output_tokens: 31, total_tokens: 12678 };
const transcript = ({ response = '{"units":[]}', status = 'SUCCESS', model = selector,
  steps = [], resultUsage = usage } = {}) => [
  { event: 'init', init: { model, tools: ['search_web'] } },
  { event: 'step_update', step_update: { step_type: 'user_input', state: 'DONE' } },
  ...steps,
  { event: 'step_update', step_update: { step_type: 'agent_response', state: 'DONE', text_delta: response } },
  { event: 'result', result: { status, response, usage: resultUsage, duration_seconds: 2 } },
].map(value => JSON.stringify(value)).join('\n') + '\n';

test('source-only native protocol returns host-parseable JSON and preserves complete raw call', async () => {
  const calls = [];
  const execute = async (args, input) => {
    assert.deepEqual(args.slice(0, 10), ['--model', selector, '--mode', 'plan', '--sandbox',
      '--disable-slash-commands', '--print-timeout', '60s', '--input-format', 'stream-json']);
    assert.ok(!args.includes('--json-schema'));
    const message = JSON.parse(input.trim());
    assert.equal(message.event, 'user');
    assert.match(message.message.content, /Extract only supplied evidence/);
    assert.match(message.message.content, /Fictional source text/);
    assert.ok(!message.message.content.includes('expected'));
    return { stdout: transcript({ response: '```json\n{"units":[]}\n```' }), stderr: 'native warning', exitCode: 0, signal: null, timedOut: false };
  };
  const result = await createAgyClient({ model: selector, calls, execute }).generate(request);
  assert.equal(result.ok, true);
  assert.equal(result.value, '{"units":[]}');
  assert.deepEqual(result.usage, { inputTokens: 12647, outputTokens: 31, totalTokens: 12678 });
  assert.equal(calls[0].raw.stderr, 'native warning');
  assert.match(calls[0].raw.stdout, /"event":"result"/);
  assert.equal(calls[0].reportedModel, selector);
  assert.equal(calls[0].usage.total_tokens, 12678);
});

test('failed, malformed, missing identity, tool, refusal and unknown-usage replies retain raw evidence', async () => {
  const variants = [
    { raw: { stdout: '{bad json', stderr: 'bad', exitCode: 0 }, reason: /NDJSON/ },
    { raw: { stdout: transcript(), stderr: 'exit failure', exitCode: 3 }, reason: /exited 3/ },
    { raw: { stdout: transcript({ status: 'REFUSED' }), stderr: '', exitCode: 0 }, reason: /status REFUSED/ },
    { raw: { stdout: transcript({ model: '' }), stderr: '', exitCode: 0 }, reason: /model identity/ },
    { raw: { stdout: transcript({ model: 'wrong-selector' }), exitCode: 0 }, reason: /unexpected model/ },
    { raw: { stdout: transcript({ steps: [{ event: 'step_update',
      step_update: { step_type: 'agent_response', subagent_info: { id: 'other' } } }] }),
      exitCode: 0 }, reason: /tool or delegated/ },
    ...['not JSON', '[]', '{} outside fence'].map(response => ({
      raw: { stdout: transcript({ response }), exitCode: 0 }, reason: /invalid JSON/ })),
    { raw: { stdout: transcript() + JSON.stringify({ event: 'result', result: {} }) + '\n',
      exitCode: 0 }, reason: /exactly one result/ },
    { raw: { stdout: '', exitCode: null, spawnError: 'fixture missing executable' }, reason: /spawn failed/ },
    { raw: { stdout: transcript({ steps: [{ event: 'step_update', step_update: { step_type: 'tool', state: 'DONE' } }] }), stderr: '', exitCode: 0 }, reason: /tool or delegated/ },
    { raw: { stdout: transcript({ steps: [{ event: 'tool_result', text: 'searched outside source' }] }), stderr: '', exitCode: 0 }, reason: /tool or delegated/ },
    { raw: { stdout: transcript({ resultUsage: null }), stderr: '', exitCode: 0 }, reason: /usage/ },
    { raw: { stdout: transcript({ resultUsage: { input_tokens: 20, output_tokens: 9, total_tokens: 28 } }), stderr: '', exitCode: 0 }, reason: /usage/ },
    { raw: { stdout: transcript(), stderr: '', exitCode: null, timedOut: true }, reason: /timed out/ },
    { raw: { stdout: transcript(), stderr: '', exitCode: null, timedOut: true, captureIncomplete: true }, reason: /incomplete/ },
  ];
  for (const { raw, reason } of variants) {
    const calls = [];
    const result = await createAgyClient({ model: selector, calls, execute: async () => raw }).generate(request);
    assert.equal(result.ok, false);
    assert.match(result.error.message, reason);
    assert.deepEqual(calls[0].raw, raw);
    assert.equal(calls[0].outcome, 'error');
    if (raw.exitCode === 3) {
      assert.equal(calls[0].reportedModel, selector);
      assert.equal(calls[0].usage.total_tokens, 12678);
    }
  }
});

test('rejects non-object NDJSON rows as failed calls while preserving the raw transcript', async () => {
  for (const row of ['null', '[]', '17', '"unexpected"', 'true']) {
    const calls = [];
    const raw = { stdout: `${row}\n${transcript()}`, stderr: 'captured stderr', exitCode: 0,
      signal: null, timedOut: false };
    const result = await createAgyClient({ model: selector, calls, execute: async () => raw }).generate(request);
    assert.equal(result.ok, false, `row ${row} must be rejected`);
    assert.match(result.error.message, /event must be a JSON object/);
    assert.equal(calls[0].outcome, 'error');
    assert.match(calls[0].error, /event must be a JSON object/);
    assert.deepEqual(calls[0].raw, raw);
  }
});

test('three-call ceiling rejects a fourth request without executing it', async () => {
  const calls = [];
  let executions = 0;
  const client = createAgyClient({ model: selector, calls, execute: async () => {
    executions++;
    return { stdout: transcript(), stderr: '', exitCode: 0 };
  } });
  for (let i = 0; i < 3; i++) assert.equal((await client.generate(request)).ok, true);
  assert.equal((await client.generate(request)).ok, false);
  assert.equal(executions, 3);
  assert.equal(calls[3].outcome, 'error');
  assert.equal(calls[3].executed, false);
});

test('process boundary captures stdout, stderr and nonzero exit before interpreting content', async () => {
  let child;
  const spawnProcess = (_executable, _args, options) => {
    assert.equal(options.cwd, '/tmp/empty-agt');
    child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => true;
    queueMicrotask(() => { child.stdout.write('partial reply'); child.stderr.write('failed');
      child.stdout.end(); child.stderr.end(); child.emit('close', 2, null); });
    return child;
  };
  const result = await runAgyProcess({ executable: 'agy', args: ['--model', selector], input: '{}\n',
    cwd: '/tmp/empty-agt', timeoutMs: 1000, spawnProcess });
  assert.deepEqual(result, { stdout: 'partial reply', stderr: 'failed', exitCode: 2,
    signal: null, timedOut: false, spawnError: null });
});

test('process boundary decodes multibyte stdout and stderr across chunk boundaries', async () => {
  const spawnProcess = () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => true;
    queueMicrotask(() => {
      const out = Buffer.from('source café', 'utf8');
      const err = Buffer.from('warning Ω', 'utf8');
      child.stdout.write(out.subarray(0, -1)); child.stdout.write(out.subarray(-1));
      child.stderr.write(err.subarray(0, -1)); child.stderr.write(err.subarray(-1));
      child.stdout.end(); child.stderr.end(); child.emit('close', 0, null);
    });
    return child;
  };
  const raw = await runAgyProcess({ executable: 'fake-agy', args: [], input: '{}\n', cwd: '/tmp',
    timeoutMs: 1000, spawnProcess });
  assert.equal(raw.stdout, 'source café');
  assert.equal(raw.stderr, 'warning Ω');
});

test('timeout waits for close and captures data written after SIGKILL', async () => {
  const spawnProcess = () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = signal => {
      if (signal === 'SIGKILL') setTimeout(() => {
        child.stdout.write('late stdout'); child.stderr.write('late stderr');
        child.stdout.end(); child.stderr.end(); child.emit('close', null, 'SIGKILL');
      }, 10);
      return true;
    };
    return child;
  };
  const raw = await runAgyProcess({ executable: 'fake-agy', args: [], input: '{}\n', cwd: '/tmp',
    timeoutMs: 5, killGraceMs: 5, spawnProcess });
  assert.deepEqual(raw, { stdout: 'late stdout', stderr: 'late stderr', exitCode: null,
    signal: 'SIGKILL', timedOut: true, spawnError: null });
});

test('process that never closes returns marked incomplete capture instead of claiming full streams', async () => {
  let spawned;
  const spawnProcess = () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => true;
    child.unref = () => { child.unreferenced = true; };
    spawned = child;
    return child;
  };
  const raw = await runAgyProcess({ executable: 'fake-agy', args: [], input: '{}\n', cwd: '/tmp',
    timeoutMs: 5, killGraceMs: 5, closeWaitMs: 5, spawnProcess });
  assert.equal(raw.captureIncomplete, true);
  assert.equal(raw.timedOut, true);
  assert.equal(spawned.stdin.destroyed, true);
  assert.equal(spawned.stdout.destroyed, true);
  assert.equal(spawned.stderr.destroyed, true);
  assert.equal(spawned.unreferenced, true);
});

test('advisory grounding failure still stops the next case after its record is saved', () => {
  const advisoryReport = { sourceDistillation: { failedClosed: false } };
  assert.equal(mustStopAgyEvaluation(advisoryReport, [{ outcome: 'ok' }, { outcome: 'error' }]), true);
  assert.equal(mustStopAgyEvaluation(advisoryReport, [{ outcome: 'ok' }, { outcome: 'ok' }]), false);
  assert.equal(mustStopAgyEvaluation({ sourceDistillation: { failedClosed: true } }, [{ outcome: 'ok' }]), true);
});

test('manual batch saves an advisory failed-call record before stopping the next case', async () => {
  const { runAgyCases } = await import('./agy-live.mjs');
  const trace = [];
  const saved = [];
  const raw = { stdout: transcript(), stderr: 'process failed', exitCode: 3 };
  await assert.rejects(() => runAgyCases({
    cases: [{ id: 'first' }, { id: 'second' }],
    provenance: { fixture: true },
    execute: async () => raw,
    run: async ({ testCase, llm }) => {
      trace.push('run:' + testCase.id);
      const result = await llm.generate(request);
      assert.equal(result.ok, false);
      return { caseId: testCase.id,
        report: { claimsExtracted: 0, sourceDistillation: { failedClosed: false } } };
    },
    save: async record => {
      await new Promise(resolve => setImmediate(resolve));
      trace.push('save:' + record.caseId);
      saved.push(record);
    },
  }), /Failed native call/);
  assert.deepEqual(trace, ['run:first', 'save:first']);
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].calls[0].raw, raw);
  assert.equal(saved[0].calls[0].outcome, 'error');
  assert.equal(saved[0].fixture, true);
});

test('never-close fallback retains an observed exit rather than inventing a signal', async () => {
  const spawnProcess = () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => true;
    child.unref = () => {};
    queueMicrotask(() => child.emit('exit', 0, null));
    return child;
  };
  const raw = await runAgyProcess({ executable: 'fake-agy', args: [], input: '{}\n', cwd: '/tmp',
    timeoutMs: 5, killGraceMs: 5, closeWaitMs: 5, spawnProcess });
  assert.equal(raw.captureIncomplete, true);
  assert.equal(raw.exitCode, 0);
  assert.equal(raw.signal, null);
});
