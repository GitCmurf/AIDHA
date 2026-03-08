import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SQLiteStore } from '@aidha/graph-backend';
import { runCli } from '../src/cli.js';
import { describeIfSqlite } from './test-utils.js';

describeIfSqlite('CLI area/goal/project helpers', () => {
  let tempRoot = '';
  let dbPath = '';

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'aidha-cli-planning-'));
    dbPath = join(tempRoot, 'aidha.sqlite');
  });

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('creates area, goal, and project nodes via CLI', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const areaCode = await runCli([
      'area',
      'create',
      '--db',
      dbPath,
      '--name',
      'Work',
      '--description',
      'Professional responsibilities',
    ]);
    const goalCode = await runCli([
      'goal',
      'create',
      '--db',
      dbPath,
      '--name',
      'Ship MVP',
      '--area',
      'area-work',
    ]);
    const projectCode = await runCli([
      'project',
      'create',
      '--db',
      dbPath,
      '--name',
      'Task Engine',
      '--area',
      'area-work',
      '--goal',
      'goal-ship-mvp',
    ]);

    logSpy.mockRestore();
    errorSpy.mockRestore();
    expect(areaCode).toBe(0);
    expect(goalCode).toBe(0);
    expect(projectCode).toBe(0);

    const store = SQLiteStore.open(dbPath);
    try {
      const areaNode = await store.getNode('area-work');
      expect(areaNode.ok).toBe(true);
      if (areaNode.ok) expect(areaNode.value?.type).toBe('Area');

      const goalNode = await store.getNode('goal-ship-mvp');
      expect(goalNode.ok).toBe(true);
      if (goalNode.ok) expect(goalNode.value?.type).toBe('Goal');

      const link = await store.getEdges({
        subject: 'area-work',
        predicate: 'relatedTo',
        object: 'goal-ship-mvp',
      });
      expect(link.ok).toBe(true);
      if (link.ok) expect(link.value.items.length).toBe(1);

      const projectNode = await store.getNode('project-task-engine');
      expect(projectNode.ok).toBe(true);
      if (projectNode.ok) expect(projectNode.value?.type).toBe('Project');

      const projectArea = await store.getEdges({
        subject: 'project-task-engine',
        predicate: 'projectInArea',
        object: 'area-work',
      });
      expect(projectArea.ok).toBe(true);
      if (projectArea.ok) expect(projectArea.value.items.length).toBe(1);

      const projectGoal = await store.getEdges({
        subject: 'project-task-engine',
        predicate: 'projectServesGoal',
        object: 'goal-ship-mvp',
      });
      expect(projectGoal.ok).toBe(true);
      if (projectGoal.ok) expect(projectGoal.value.items.length).toBe(1);
    } finally {
      await store.close();
    }
  }, 20_000);
});
