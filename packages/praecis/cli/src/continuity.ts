// SPDX-License-Identifier: Apache-2.0
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import type { GraphStore } from '@aidha/graph-backend';
import { captureCase, continuityInputSchema, renderContinuityMarkdown, showCase, updateCase } from '@aidha/praecis-core';

type Options = Record<string, string | boolean | undefined>;
const MAX_INPUT_BYTES = 1024 * 1024;

async function readJsonInput(path: string): Promise<unknown> {
  // O_NONBLOCK prevents a FIFO at the supplied path from blocking before fstat.
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    if (!(await file.stat()).isFile()) throw new Error('Continuity input must be a regular file');
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    while (true) {
      const buffer = Buffer.alloc(Math.min(64 * 1024, MAX_INPUT_BYTES + 1 - totalBytes));
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
      if (totalBytes > MAX_INPUT_BYTES) throw new Error('Continuity input exceeds 1 MiB');
      chunks.push(buffer.subarray(0, bytesRead));
    }
    const jsonText = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, totalBytes));
    return JSON.parse(jsonText) as unknown;
  } finally {
    await file.close();
  }
}

export async function runContinuity(
  command: string | undefined,
  options: Options,
  withStore: <T>(work: (store: GraphStore) => Promise<T>) => Promise<T>,
): Promise<number> {
  const usage = [
    'AIDHA continuity: capture source-backed context and record direct fact corrections.',
    '  schema --kind capture|update',
    '  capture --case <id> --input <json>',
    '  update --case <id> --input <json>',
    '  show --case <id> --on <YYYY-MM-DD> [--json]',
    'Use --config <path> [--profile <name>] to select the database.',
  ].join('\n');
  const required = (key: string): string => {
    const value = options[key];
    if (typeof value !== 'string' || !value) throw new Error(`continuity requires --${key}`);
    return value;
  };

  if (options['help'] === true) {
    console.log(usage);
    return 0;
  }
  if (command === 'schema') {
    const kind = required('kind');
    if (kind !== 'capture' && kind !== 'update') throw new Error('--kind must be capture or update');
    console.log(JSON.stringify(continuityInputSchema(kind), null, 2));
    return 0;
  }
  if (command === 'capture' || command === 'update') {
    const input = await readJsonInput(required('input'));
    const result = await withStore(store => (command === 'capture' ? captureCase : updateCase)(store, required('case'), input));
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }
  if (command === 'show') {
    const view = await withStore(store => showCase(store, required('case'), required('on')));
    console.log(options['json'] === true ? JSON.stringify(view, null, 2) : renderContinuityMarkdown(view));
    return 0;
  }
  throw new Error(usage);
}
