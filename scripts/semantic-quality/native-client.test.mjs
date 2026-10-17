import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNativeClient } from './native-client.mjs';

test('forwards the requested schema and consumes a native structured result without prose fallback', async () => {
  const schema = { type: 'object', properties: { units: { type: 'array' } }, required: ['units'] };
  const calls = [];
  const client = createNativeClient({ model: 'test-model', calls, execute: async (args, user) => {
    assert.equal(args[args.indexOf('--json-schema') + 1], JSON.stringify(schema));
    assert.equal(user, 'Source only');
    return { structured_output: { units: [] }, result: '', usage: {
      input_tokens: 10, cache_creation_input_tokens: 20, cache_read_input_tokens: 30, output_tokens: 5 }, is_error: false };
  } });
  const result = await client.generate({ system: 'Extract', user: 'Source only', responseFormat: { type: 'json_schema', schema } });
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(result.value), { units: [] });
  assert.deepEqual(result.usage, { inputTokens: 60, outputTokens: 5, totalTokens: 65 });
  assert.equal(calls.length, 1);
});

test('retains every constraint while omitting the unsupported schema dialect declaration', async () => {
  const schema = { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', properties: { kind: { enum: ['fact', 'idea'] } } };
  const client = createNativeClient({ model: 'test-model', calls: [], execute: async args => {
    const forwarded = JSON.parse(args[args.indexOf('--json-schema') + 1]);
    assert.deepEqual(forwarded, { type: 'object', properties: { kind: { enum: ['fact', 'idea'] } } });
    return { structured_output: { kind: 'fact' } };
  } });
  assert.equal((await client.generate({ system: '', user: '', responseFormat: { type: 'json_schema', schema } })).ok, true);
});

test('rejects prose when a requested structured result is absent', async () => {
  const calls = [];
  const reply = { result: '{"units":[]}', usage: { input_tokens: 8, output_tokens: 2 },
    modelUsage: { 'test-model': { inputTokens: 8 } }, duration_ms: 120 };
  const client = createNativeClient({ model: 'test-model', calls, execute: async () => reply });
  await assert.rejects(client.generate({ system: '', user: '', responseFormat: { type: 'json_schema', schema: { type: 'object' } } }), /requested completion format/);
  assert.deepEqual(calls[0].nativeReply, reply);
  assert.deepEqual(calls[0].usage, reply.usage);
  assert.deepEqual(calls[0].modelUsage, reply.modelUsage);
  assert.equal(calls[0].durationMs, reply.duration_ms);
});

test('retains the complete native error reply and usage before rejecting it', async () => {
  const calls = [];
  const reply = { is_error: true, subtype: 'rate_limit', result: 'Try again later',
    usage: { input_tokens: 12, cache_read_input_tokens: 3, output_tokens: 1 },
    modelUsage: { 'test-model': { inputTokens: 15 } }, duration_ms: 230 };
  const client = createNativeClient({ model: 'test-model', calls, execute: async () => reply });
  await assert.rejects(client.generate({ system: '', user: 'Source only' }), /Native CLI failed: rate_limit/);
  assert.deepEqual(calls[0].nativeReply, reply);
  assert.deepEqual(calls[0].usage, reply.usage);
  assert.deepEqual(calls[0].modelUsage, reply.modelUsage);
  assert.equal(calls[0].durationMs, reply.duration_ms);
});
