import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { capture } from '../../core/tests/continuity/fixture.js';

const root = resolve(import.meta.dirname, '../../../..');
const directories: string[] = [];
// Real CLI startup can exceed 15 seconds; retain finite child and sequence limits.
const CHILD_PROCESS_TIMEOUT_MS = 60_000;
const PROCESS_TEST_TIMEOUT_MS = 600_000;

it('prints trusted usage on readable lines without opening a database', () => {
  const { invoke, dir } = setup();
  const result = invoke('unrecognised');
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('\n  schema --kind capture|update\n');
  expect(result.stderr).not.toContain('\\u000a');
  expect(existsSync(join(dir, 'graph.sqlite'))).toBe(false);
}, PROCESS_TEST_TIMEOUT_MS);


it('show refuses missing explicit config even when a populated project fallback exists', () => {
  const { call, input, invokeWithConfig, invokeWithoutProfileWithEnv, dir } = setup();
  call('capture', '--case', 'friday', '--input', input('capture', capture));
  const database = join(dir, 'graph.sqlite');
  const before = readFileSync(database);
  mkdirSync(join(dir, '.aidha'));
  writeFileSync(join(dir, '.aidha', 'config.yaml'), readFileSync(join(dir, 'config.yaml')));
  const positive = invokeWithoutProfileWithEnv({},
    'show', '--case', 'friday', '--on', '2026-10-02', '--json');
  expect(positive.status, positive.stderr).toBe(0);
  expect(JSON.parse(positive.stdout).title).toBe('Friday activities');
  const missing = join(dir, 'missing-selected.yaml');
  for (const result of [
    invokeWithConfig(missing, 'show', '--case', 'friday', '--on', '2026-10-02', '--json'),
    invokeWithoutProfileWithEnv({ AIDHA_CONFIG: missing },
      'show', '--case', 'friday', '--on', '2026-10-02', '--json'),
  ]) {
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/not found|does not exist|ENOENT|no such file/i);
    expect(result.stderr).toContain('missing-selected.yaml');
    expect(result.stdout).not.toContain('Friday activities');
    expect(readFileSync(database)).toEqual(before);
  }
}, PROCESS_TEST_TIMEOUT_MS);


it('show never creates a missing database and leaves existing database bytes unchanged', () => {
  const { call, input, invoke, dir } = setup();
  const database = join(dir, 'graph.sqlite');
  const missing = invoke('show', '--case', 'friday', '--on', '2026-10-02', '--json');
  expect(missing.status).toBe(1);
  expect(existsSync(database)).toBe(false);
  call('capture', '--case', 'friday', '--input', input('capture', capture));
  const before = readFileSync(database);
  const filesBefore = readdirSync(dir).sort();
  call('show', '--case', 'friday', '--on', '2026-10-02', '--json');
  const markdown = invoke('show', '--case', 'friday', '--on', '2026-10-02');
  expect(markdown.status, markdown.stderr).toBe(0);
  expect(readFileSync(database)).toEqual(before);
  expect(readdirSync(dir).sort()).toEqual(filesBefore);
}, PROCESS_TEST_TIMEOUT_MS);

it('rejects invalid case, date and event input before opening a database', () => {
  const { input, invoke, dir } = setup();
  const goodInput = input('capture', capture);
  for (const args of [
    ['capture', '--input', goodInput],
    ['capture', '--case', '?invalid', '--input', goodInput],
    ['capture', '--case', 'friday', '--input', input('invalid-schema', { kind: 'capture' })],
    ['show', '--case', 'friday', '--on', 'not-a-date'],
  ]) {
    const result = invoke(...args);
    expect(result.status).toBe(1);
    expect(existsSync(join(dir, 'graph.sqlite'))).toBe(false);
  }
}, PROCESS_TEST_TIMEOUT_MS);

it('failed input prints no live display controls or malformed JSON source fragments', () => {
  const { input, invoke, dir } = setup();
  const bad = structuredClone(capture);
  bad.facts[0] = { ...bad.facts[0]!, key: 'venue\u001b[2J\u0085' };
  bad.facts.push({ ...bad.facts[0], id: 'conflict' });
  const rejected = invoke('capture', '--case', 'bad-key', '--input', input('bad-key', bad));
  expect(rejected.status).toBe(1);
  expect(rejected.stderr).not.toMatch(/[\u001b\u0080-\u009f]/u);
  const malformed = join(dir, 'malformed.json');
  writeFileSync(malformed, 'PRIVATE-FIXTURE-TEXT not JSON', 'utf8');
  const parsed = invoke('capture', '--case', 'bad-json', '--input', malformed);
  expect(parsed.status).toBe(1);
  expect(parsed.stderr).toContain('Continuity input is not valid JSON');
  expect(parsed.stderr).not.toContain('PRIVATE-FIXTURE-TEXT');
}, PROCESS_TEST_TIMEOUT_MS);


afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'aidha-continuity-cli-'));
  directories.push(dir);
  const home = join(dir, 'home');
  mkdirSync(home);
  const config = join(dir, 'config.yaml');
  writeFileSync(config, [
    'config_version: 1', 'default_profile: test', 'profiles:', '  test:',
    `    db: ${JSON.stringify(join(dir, 'graph.sqlite'))}`, '',
  ].join('\n'), 'utf8');
  const invokeWithConfig = (selectedConfig: string, ...args: string[]) => {
    // Child processes have no provider credentials or access to user configuration.
    return spawnSync(process.execPath, [
      '--experimental-sqlite', join(root, 'packages/praecis/cli/dist/cli.js'),
      'continuity', ...args, '--config', selectedConfig, '--profile', 'test',
    ], {
      cwd: dir, encoding: 'utf8', timeout: CHILD_PROCESS_TIMEOUT_MS,
      env: { PATH: process.env['PATH'], HOME: home, XDG_CONFIG_HOME: home },
    });
  };
  const invoke = (...args: string[]) => invokeWithConfig(config, ...args);
  const invokeWithoutProfileWithEnv = (extraEnv: NodeJS.ProcessEnv, ...args: string[]) => spawnSync(process.execPath, [
    '--experimental-sqlite', join(root, 'packages/praecis/cli/dist/cli.js'),
    'continuity', ...args,
  ], {
    cwd: dir, encoding: 'utf8', timeout: CHILD_PROCESS_TIMEOUT_MS,
    env: { PATH: process.env['PATH'], HOME: home, XDG_CONFIG_HOME: home, ...extraEnv },
  });
  const invokeWithoutProfile = (...args: string[]) => invokeWithoutProfileWithEnv({}, ...args);
  const call = (...args: string[]) => {
    const result = invoke(...args);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trimStart()).toMatch(/^\{/u);
    return JSON.parse(result.stdout);
  };
  const input = (name: string, value: unknown) => {
    const path = join(dir, `${name}.json`);
    writeFileSync(path, JSON.stringify(value), 'utf8');
    return path;
  };
  return { call, input, invoke, invokeWithConfig, invokeWithoutProfile, invokeWithoutProfileWithEnv, dir, home };
}

it('exposes the strict capture/update schemas and command help without opening a database', () => {
  const { invoke, dir } = setup();
  const schema = invoke('schema', '--kind', 'capture');
  expect(schema.status, schema.stderr).toBe(0);
  const contract = JSON.parse(schema.stdout);
  expect(contract.additionalProperties).toBe(false);
  expect(contract.required).toContain('source');
  expect(contract.properties.facts.description).toMatch(/responsibilities and ownership as explicit facts/i);
  expect(existsSync(join(dir, 'graph.sqlite'))).toBe(false);

  const help = invoke('--help');
  expect(help.status, help.stderr).toBe(0);
  expect(help.stdout).toContain('AIDHA continuity');
  expect(help.stdout).toContain('capture --case');
  expect(existsSync(join(dir, 'graph.sqlite'))).toBe(false);

  const invalid = invoke('schema', '--kind', 'other');
  expect(invalid.status).toBe(1);
  expect(invalid.stderr).toMatch(/--kind must be capture or update/i);
}, PROCESS_TEST_TIMEOUT_MS);

it('accepts an exact 1 MiB input and rejects larger or non-file inputs before store access', () => {
  const { call, invoke, invokeWithConfig, dir } = setup();
  const maxBytes = 1024 * 1024;
  const serialized = JSON.stringify(capture);
  const exactPath = join(dir, 'exact-limit.json');
  writeFileSync(exactPath, serialized + ' '.repeat(maxBytes - Buffer.byteLength(serialized)), 'utf8');
  expect(call('capture', '--case', 'friday', '--input', exactPath).revision).toBe(1);
  const saved = call('show', '--case', 'friday', '--on', '2026-10-02', '--json');

  const absentDb = join(dir, 'must-not-open.sqlite');
  const alternateConfig = join(dir, 'alternate.yaml');
  writeFileSync(alternateConfig, [
    'config_version: 1', 'default_profile: test', 'profiles:', '  test:',
    `    db: ${JSON.stringify(absentDb)}`, '',
  ].join('\n'), 'utf8');
  const oversized = join(dir, 'over-limit.json');
  writeFileSync(oversized, serialized + ' '.repeat(maxBytes - Buffer.byteLength(serialized) + 1), 'utf8');
  const rejected = invokeWithConfig(alternateConfig, 'update', '--case', 'friday', '--input', oversized);
  expect(rejected.status).toBe(1);
  expect(rejected.stderr).toMatch(/exceeds 1 MiB/i);
  expect(existsSync(absentDb)).toBe(false);

  const notAFile = invoke('update', '--case', 'friday', '--input', dir);
  expect(notAFile.status).toBe(1);
  expect(notAFile.stderr).toMatch(/regular file/i);
  expect(call('show', '--case', 'friday', '--on', '2026-10-02', '--json')).toEqual(saved);
}, PROCESS_TEST_TIMEOUT_MS);

it('fails closed for a missing explicit config without creating a fallback database', () => {
  const { input, invokeWithoutProfile, dir, home } = setup();
  const missingConfig = join(dir, 'misspelled-config.yaml');
  const result = invokeWithoutProfile('capture', '--case', 'friday', '--input', input('capture', capture), '--config', missingConfig);
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/config.*not found|not found.*config/i);
  expect(existsSync(join(home, '.local', 'share', 'aidha', 'aidha.sqlite'))).toBe(false);
  expect(existsSync(join(dir, 'graph.sqlite'))).toBe(false);
}, PROCESS_TEST_TIMEOUT_MS);

it('uses the default profile from a valid explicit config when --profile is omitted', () => {
  const { input, invokeWithoutProfile, dir } = setup();
  const result = invokeWithoutProfile('capture', '--case', 'friday', '--input', input('capture', capture), '--config', join(dir, 'config.yaml'));
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ caseId: 'friday', revision: 1, replayed: false });
  expect(existsSync(join(dir, 'graph.sqlite'))).toBe(true);
}, PROCESS_TEST_TIMEOUT_MS);

it('fails closed for a missing AIDHA_CONFIG and honors a valid CLI config over it', () => {
  const { input, invokeWithoutProfileWithEnv, dir, home } = setup();
  const missingConfig = join(dir, 'missing-env-config.yaml');
  const envFailure = invokeWithoutProfileWithEnv(
    { AIDHA_CONFIG: missingConfig }, 'capture', '--case', 'friday', '--input', input('env-capture', capture),
  );
  expect(envFailure.error).toBeUndefined();
  expect(envFailure.status).toBe(1);
  expect(envFailure.stderr).toMatch(/config.*not found|not found.*config/i);
  expect(existsSync(join(home, '.local', 'share', 'aidha', 'aidha.sqlite'))).toBe(false);

  const cliOverridesEnv = invokeWithoutProfileWithEnv(
    { AIDHA_CONFIG: missingConfig }, 'capture', '--case', 'friday', '--input', input('cli-capture', capture),
    '--config', join(dir, 'config.yaml'),
  );
  expect(cliOverridesEnv.error).toBeUndefined();
  expect(cliOverridesEnv.status, cliOverridesEnv.stderr).toBe(0);
  expect(JSON.parse(cliOverridesEnv.stdout)).toEqual({ caseId: 'friday', revision: 1, replayed: false });
}, PROCESS_TEST_TIMEOUT_MS);

it.each([
  { flags: ['--config'] },
  { flags: ['--config', join(tmpdir(), 'unused-explicit-config.yaml'), '--profile'] },
])('rejects missing option values instead of selecting defaults', ({ flags }) => {
  const { input, invokeWithoutProfile, dir, home } = setup();
  const result = invokeWithoutProfile('capture', '--case', 'friday', '--input', input('capture', capture), ...flags);
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/--(?:config|profile).*(?:value|required)/i);
  expect(existsSync(join(home, '.local', 'share', 'aidha', 'aidha.sqlite'))).toBe(false);
  expect(existsSync(join(dir, 'graph.sqlite'))).toBe(false);
}, PROCESS_TEST_TIMEOUT_MS);

describe('continuity through the built public package executable', () => {
  it('captures, corrects and recovers exact source history across fresh processes', () => {
    const { call, input, invoke } = setup();
    expect(call('capture', '--case', 'friday', '--input', input('capture', capture)))
      .toEqual({ caseId: 'friday', revision: 1, replayed: false });
    const resumed = call('show', '--case', 'friday', '--on', '2026-10-02', '--json');
    expect(resumed.caseId).toBe('friday');
    expect(resumed.sources).toEqual([capture.source]);
    expect(resumed.activities).toEqual(capture.activities);
    expect(resumed.facts).toEqual(capture.facts.map(fact => ({ ...fact, sourceId: capture.source.id })));
    expect(resumed.decisions).toEqual({ current: capture.decisions, otherDates: [] });
    expect(resumed.questions).toEqual(capture.questions);
    expect(resumed.intent).toBe('illustrative');

    const correction = {
      kind: 'correct', eventId: 'venue-correction', expectedRevision: 1,
      source: { ...capture.source, id: 'correction-source', text: 'The venue is East Hall.' },
      interpreter: 'fixture-correction', factId: 'venue', value: 'East Hall', basis: 'supplied',
    };
    expect(call('update', '--case', 'friday', '--input', input('correction', correction)))
      .toEqual({ caseId: 'friday', revision: 2, replayed: false });

    const corrected = call('show', '--case', 'friday', '--on', '2026-10-02', '--json');
    expect(corrected.facts).toEqual([
      { ...capture.facts[0], value: 'East Hall', basis: 'supplied', sourceId: correction.source.id },
      { ...capture.facts[1], sourceId: capture.source.id },
    ]);
    expect(corrected.sources).toEqual([capture.source, correction.source]);
    expect(corrected.history.map((record: { event: unknown }) => record.event)).toEqual([capture, correction]);
    expect(corrected.decisions).toEqual(resumed.decisions);
    expect(corrected.questions).toEqual(resumed.questions);

    expect(call('update', '--case', 'friday', '--input', input('correction-retry', correction)))
      .toEqual({ caseId: 'friday', revision: 2, replayed: true });
    expect(call('show', '--case', 'friday', '--on', '2026-10-02', '--json')).toEqual(corrected);

    const stale = {
      ...correction, eventId: 'stale-correction', expectedRevision: 1,
      source: { ...correction.source, id: 'stale-source' }, value: 'South Hall',
    };
    const stalePath = input('stale-correction', stale);
    const failure = invoke('update', '--case', 'friday', '--input', stalePath);
    expect(failure.error).toBeUndefined();
    expect(failure.status).toBe(1);
    expect(failure.stderr).toMatch(/revision conflict/i);
    expect(call('show', '--case', 'friday', '--on', '2026-10-02', '--json')).toEqual(corrected);
  }, PROCESS_TEST_TIMEOUT_MS);
});
