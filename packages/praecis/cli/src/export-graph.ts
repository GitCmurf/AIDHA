// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { SQLiteStore, serializeJsonLd, toJsonLd } from '@aidha/graph-backend';
import { chmod, link, lstat, mkdtemp, open, realpath, rm, stat, type FileHandle } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

export interface GraphExportOptions {
  readonly configPath?: string;
  readonly profile?: string;
  readonly out?: string;
}

const EXPORT_USAGE = 'Usage: aidha export graph --jsonld [--out <new-file>] [--config <path>] [--profile <name>]';

export function parseGraphExport(argv: readonly string[]): GraphExportOptions {
  const { positionals, values } = parseArgs({
    args: [...argv],
    strict: true,
    allowPositionals: true,
    options: {
      jsonld: { type: 'boolean' },
      config: { type: 'string' },
      profile: { type: 'string' },
      out: { type: 'string' },
    },
  });
  if (positionals.length !== 2 || positionals[0] !== 'export' || positionals[1] !== 'graph' || values.jsonld !== true) {
    throw new Error(EXPORT_USAGE);
  }
  for (const value of [values.config, values.profile, values.out]) {
    if (value !== undefined && value.trim().length === 0) {
      throw new Error(EXPORT_USAGE);
    }
  }
  return {
    ...(values.config !== undefined ? { configPath: values.config } : {}),
    ...(values.profile !== undefined ? { profile: values.profile } : {}),
    ...(values.out !== undefined ? { out: values.out } : {}),
  };
}

/** Publish complete data without replacing a destination or unlinking another owner's path. */
export async function writeNewOutput(path: string, contents: string): Promise<void> {
  let exists = false;
  try { await lstat(path); exists = true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (exists) throw Object.assign(new Error(`Output already exists: ${path}`), { code: 'EEXIST' });

  const directory = await mkdtemp(join(dirname(path), '.aidha-export-'));
  const staged = join(directory, 'document');
  let file: FileHandle | undefined;
  let failure: { error: unknown } | undefined;
  try {
    await chmod(directory, 0o700);
    file = await open(staged, 'wx', 0o600);
    await file.chmod(0o600);
    await file.writeFile(contents, 'utf8');
    await file.close();
    file = undefined;
    // A hard link publishes the closed, complete inode atomically and never replaces path.
    await link(staged, path);
  } catch (error) {
    failure = { error };
  } finally {
    try { await file?.close(); } catch (error) { failure ??= { error }; }
    // Cleanup owns only the private staging directory, never the destination path.
    try { await rm(directory, { recursive: true, force: true }); }
    catch (error) { failure ??= { error }; }
  }
  if (failure) throw failure.error;
}

async function protectDatabaseDestination(databasePath: string, outputPath: string): Promise<string> {
  const database = resolve(databasePath);
  const output = resolve(outputPath);
  const originalName = join(await realpath(dirname(database)), basename(database));
  const canonicalDatabase = await realpath(database);
  const canonicalOutput = join(await realpath(dirname(output)), basename(output));
  const outputDirectory = await stat(dirname(canonicalOutput));
  // Reserve case variants on every filesystem; platform names do not establish
  // whether the mounted filesystem is case-sensitive. Compare physical parents
  // so unrelated directories with case-distinct names remain independent.
  for (const databaseName of [originalName, canonicalDatabase]) {
    const databaseDirectory = await stat(dirname(databaseName));
    if (databaseDirectory.dev !== outputDirectory.dev || databaseDirectory.ino !== outputDirectory.ino) continue;
    const reserved = ['', '-wal', '-shm', '-journal'].map(suffix => `${basename(databaseName)}${suffix}`.toLowerCase());
    if (reserved.includes(basename(canonicalOutput).toLowerCase())) {
      throw new Error('Output cannot target the database or a SQLite sidecar.');
    }
  }
  return canonicalOutput;
}

export async function exportGraphJsonLd(databasePath: string, outputPath?: string): Promise<string | undefined> {
  const destination = outputPath === undefined ? undefined
    : await protectDatabaseDestination(databasePath, outputPath);
  const snapshot = await SQLiteStore.readSnapshot(databasePath, { scope: 'full' });
  if (!snapshot.ok) throw snapshot.error;
  const document = serializeJsonLd(toJsonLd(snapshot.value.nodes, snapshot.value.edges));
  if (destination !== undefined) {
    await writeNewOutput(destination, `${document}\n`);
    return undefined;
  }
  return document;
}
