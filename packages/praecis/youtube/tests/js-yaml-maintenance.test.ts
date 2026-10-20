import { expect, it } from 'vitest';
import { load, type LoadOptions } from 'js-yaml';

// Four empty sources consume the merge budget even though they contribute no keys.
const emptyMergeSources = [
  'sources: &sources [{}, {}, {}, {}]',
  'configuration:',
  '  <<: *sources',
  '  mode: retained',
].join('\n');

const loadWithMergeCap = (maxTotalMergeKeys: number) =>
  load(emptyMergeSources, { maxTotalMergeKeys } as LoadOptions & { maxTotalMergeKeys: number });

it('exhausts a merge-source budget even when all four source mappings are empty', () => {
  expect(() => loadWithMergeCap(3)).toThrow(/maxTotalMergeKeys/u);
});

it('parses the same small document when its merge-source budget is sufficient', () => {
  expect(loadWithMergeCap(4)).toEqual({
    sources: [{}, {}, {}, {}],
    configuration: { mode: 'retained' },
  });
});
