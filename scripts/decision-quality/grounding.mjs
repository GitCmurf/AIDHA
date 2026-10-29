import { parseSourceDistillation, verifyDistillationEvidence } from '../../packages/praecis/core/dist/index.js';

/** Parse a case with the production unit and literal evidence gates. */
function parseGroundingCase(testCase) {
  if (!testCase || typeof testCase !== 'object' || !testCase.source ||
      !Array.isArray(testCase.excerpts) || testCase.excerpts.length === 0 || !testCase.unit) {
    throw new TypeError('Grounding case needs a source, excerpts, and one unit');
  }
  if (typeof testCase.source.id !== 'string' || !testCase.source.id ||
      typeof testCase.source.title !== 'string' || !testCase.source.title) {
    throw new TypeError('Grounding case source needs a nonempty ID and title');
  }
  const excerptIds = new Set();
  const excerptTextById = new Map();
  for (const excerpt of testCase.excerpts) {
    if (!excerpt || typeof excerpt.id !== 'string' || !excerpt.id || typeof excerpt.text !== 'string' ||
        !excerpt.text || excerptIds.has(excerpt.id)) {
      throw new TypeError('Grounding case excerpts need unique nonempty IDs and text');
    }
    excerptIds.add(excerpt.id);
    excerptTextById.set(excerpt.id, excerpt.text);
  }
  const parsed = parseSourceDistillation(JSON.stringify({
    schemaVersion: 1,
    sourceType: 'other',
    sourceCoherence: 'single_topic',
    theses: [],
    units: [testCase.unit],
  }), excerptIds);
  if (!parsed.ok) throw new TypeError(`Invalid grounding unit: ${parsed.errors.join('; ')}`);
  const verification = verifyDistillationEvidence(parsed.value.units, excerptTextById);
  if (verification.failedUnitIds.length > 0) {
    throw new TypeError(`Grounding case has nonliteral or invalid quote evidence for ${verification.failedUnitIds.join(', ')}`);
  }
  return parsed.value.units[0];
}

/** Validate case structure and production-host literal quotation eligibility. */
export function validateGroundingCase(testCase) {
  parseGroundingCase(testCase);
  return true;
}

/** Construct only the source and claim visible to the decision model. */
export function buildGroundingRequest(testCase) {
  const unit = parseGroundingCase(testCase);
  return {
    state: {
      source: { id: testCase.source.id, title: testCase.source.title },
      excerpts: testCase.excerpts.map(({ id, text }) => ({ id, text })),
      unit,
    },
    questions: {
      verdict: {
        type: 'choice',
        instructions: 'Judge whether this unit faithfully represents its cited source excerpt(s). Read all excerpts for correction and context, but additional context does not substitute for the unit’s own cited evidence. Include the unit text, kind, rationale, conditions, attribution, stance, and any claimed measurement in the judgment. Select a verdict only; do not propose revised prose.',
        criteria: {
          grounded: 'The unit is supported as written, including its scope, timing, attribution, rationale, and strength of outcome claims.',
          rewrite: 'The cited evidence preserves the core observation or action after a local repair to scope, rationale, method, or attribution. Priority rule: choose rewrite when only a secondary method or attribution is wrong and the same sourced core observation remains. This verdict does not assert any repaired prose has been produced.',
          ungrounded: 'The central event, outcome, or mechanism is unsupported or contradicted by the source, so repair would replace the substantive claim. A literal quote alone is insufficient.',
          unknown: 'The available evidence is insufficient or ambiguous to judge reliably; abstain instead of guessing.',
        },
      },
    },
  };
}
