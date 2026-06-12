import { describe, expect, it } from 'vitest';
import { projectUnit, EXTRACTION_INTENTS } from '../../../src/extract/distill/projection.js';
import { SOURCE_TYPES, UNIT_KINDS, UNIT_IMPORTANCES } from '../../../src/extract/distill/schema.js';

describe('projectUnit', () => {
  it('projects substantive core/supporting units to claims under knowledge_graph', () => {
    for (const kind of ['idea', 'mechanism', 'fact', 'recommendation', 'limitation'] as const) {
      expect(projectUnit('knowledge_graph', 'explainer', kind, 'core')).toBe('claim');
      expect(projectUnit('knowledge_graph', 'explainer', kind, 'supporting')).toBe('claim');
    }
  });

  it('projects examples to supportingEvidence regardless of source type', () => {
    expect(projectUnit('knowledge_graph', 'demo', 'example', 'core')).toBe('supportingEvidence');
    expect(projectUnit('knowledge_graph', 'tutorial', 'example', 'supporting')).toBe('supportingEvidence');
  });

  it('demotes procedures under knowledge_graph even for tutorials', () => {
    expect(projectUnit('knowledge_graph', 'tutorial', 'procedure', 'core')).toBe('procedure');
  });

  it('promotes procedures to claims under runbook intent', () => {
    expect(projectUnit('runbook', 'tutorial', 'procedure', 'core')).toBe('claim');
  });

  it('projects incidental units to diagnostic regardless of kind', () => {
    expect(projectUnit('knowledge_graph', 'explainer', 'idea', 'incidental')).toBe('diagnostic');
    expect(projectUnit('runbook', 'tutorial', 'procedure', 'incidental')).toBe('diagnostic');
  });

  it('is total over the full input space', () => {
    for (const intent of EXTRACTION_INTENTS) {
      for (const sourceType of SOURCE_TYPES) {
        for (const kind of UNIT_KINDS) {
          for (const importance of UNIT_IMPORTANCES) {
            expect(['claim', 'supportingEvidence', 'procedure', 'diagnostic'])
              .toContain(projectUnit(intent, sourceType, kind, importance));
          }
        }
      }
    }
  });
});
