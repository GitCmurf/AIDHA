import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

function readPlanDoc(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const planPath = resolve(
    moduleDir,
    '..',
    '..',
    '..',
    'docs/05-planning/plan-005-user-configuration-profiles.md',
  );

  try {
    return readFileSync(planPath, 'utf-8');
  } catch (error) {
    throw new Error(
      `Failed to read plan doc at ${planPath} from ${import.meta.url}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

describe('plan-005 contract text', () => {
  it('keeps the source-private merge order explicit and safe', () => {
    const text = readPlanDoc();
    const sectionStart = text.indexOf(
      'private payload is built from source built-in defaults',
    );

    expect(sectionStart).toBeGreaterThan(-1);

    const sectionText = text.slice(sectionStart);
    const defaultProfileIndex = sectionText.indexOf(
      'profiles.default.source_overrides.<source-id>',
    );
    const sourceDefaultsIndex = sectionText.indexOf(
      'sources.<source-id>',
      defaultProfileIndex,
    );

    expect(defaultProfileIndex).toBeGreaterThan(-1);
    expect(sourceDefaultsIndex).toBeGreaterThan(-1);
    expect(defaultProfileIndex).toBeLessThan(sourceDefaultsIndex);
    expect(sectionText).toContain(
      'Tier 3 `sources.<source-id>` defaults outranking Tier 4 default-profile',
    );
  });

  it('documents a YAML-safe double-quoted interpolation escape', () => {
    const text = readPlanDoc();
    const interpolationStart = text.indexOf('In YAML double-quoted');

    expect(interpolationStart).toBeGreaterThan(-1);

    const interpolationText = text.slice(interpolationStart);
    expect(interpolationText).toContain(
      'write `\\\\${VAR}` so the YAML parser emits the backslash before',
    );
    expect(interpolationText).toContain(
      'plain or single-quoted scalars, `\\${VAR}` is sufficient.',
    );
  });
});
