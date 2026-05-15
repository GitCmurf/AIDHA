import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

function readPlanDoc(): string {
  const repoRoot = resolve(process.cwd(), '..', '..');
  const planPath = resolve(
    repoRoot,
    'docs/05-planning/plan-005-user-configuration-profiles.md',
  );
  return readFileSync(planPath, 'utf-8');
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
