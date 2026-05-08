import { escapeTripleQuoted, sanitizeForPrompt } from '../prompt-safety.js';
import type { ExtractionPromptPackId } from '../prompt-routing.js';

export const SELF_IMPROVE_PROMPT_VERSION = 'self-improve-claims-v1';

export interface SelfImprovePromptInput {
  resourceLabel: string;
  maxClaims: number;
  currentClaimsJson: string;
  supportingExcerptsJson: string;
  improvementHintsJson?: string;
  promptPackId?: ExtractionPromptPackId;
  retryReason?: string;
}

function buildPackSpecificRubric(promptPackId?: ExtractionPromptPackId): string[] {
  switch (promptPackId) {
    case 'enumeration-framework-v2':
      return [
        '- Add or preserve one umbrella/root claim for the named set before the member claims.',
        '- Preserve the set-level claim, cardinality, and member labels when the transcript names a finite list or framework.',
        '- Do not let revision drop the umbrella claim while keeping only the member details.',
        '- Restore all named members of the finite set when the current extraction omits some of them.',
        '- Preserve member-purpose claims and explicit avoid or do-not-use rules tied to the framework.',
      ];
    case 'clinical-risk-management-v2':
      return [
        '- Add or preserve the foundational definition/composition claim before narrower clinical details.',
        '- Preserve the clinical scaffold when present: risk significance, prevalence/genetic basis, testing or thresholds, management principles, and residual uncertainty.',
        '- Prefer an organized clinical framework over isolated therapy or mechanism facts.',
      ];
    default:
      return [];
  }
}

export function buildSelfImproveClaimsPrompt(input: SelfImprovePromptInput): { system: string; user: string } {
  const system = [
    'You are auditing and improving an existing claim extraction from a transcript.',
    'Return ONLY valid JSON matching the original extraction schema.',
    'Do not explain your reasoning.',
    'Preserve excerptIds exactly as provided in the supporting excerpt set.',
  ].join('\n');

  const user = [
    `VIDEO_LABEL: """${escapeTripleQuoted(sanitizeForPrompt(input.resourceLabel, 200))}"""`,
    `Target: return no more than ${input.maxClaims} claims.`,
    '',
    'AUDIT RUBRIC:',
    '- Add one root or framework claim if the current set only contains details.',
    '- Preserve named lists, frameworks, and explicit enumerations when present.',
    '- Add missing parent themes when children appear without their broader umbrella.',
    '- Remove duplicates, fragments, and claims that are not standalone.',
    '- Prefer complete, auditable, transcript-grounded assertions over vague summaries.',
    '- Keep technical terms, numbers, and units exact when they appear in the source.',
    ...buildPackSpecificRubric(input.promptPackId),
    '',
    'CURRENT_CLAIMS_JSON:',
    `"""${escapeTripleQuoted(input.currentClaimsJson)}"""`,
    '',
    'SUPPORTING_EXCERPTS_JSON:',
    `"""${escapeTripleQuoted(input.supportingExcerptsJson)}"""`,
    '',
    ...(input.improvementHintsJson
      ? [
          'TEACHER_GUIDANCE_JSON:',
          `"""${escapeTripleQuoted(input.improvementHintsJson)}"""`,
          '',
          'Use the teacher guidance as a soft target for missing structure and content.',
          'Do not copy wording mechanically; keep claims transcript-grounded and only include supported content.',
          '',
        ]
      : []),
    ...(input.promptPackId
      ? [
          `PROMPT_PACK: ${input.promptPackId}`,
          ...(input.retryReason ? [`RETRY_REASON: ${sanitizeForPrompt(input.retryReason, 500)}`] : []),
          '',
        ]
      : []),
    'Return the improved claim set as JSON with the same schema as the original extraction output.',
  ].join('\n');

  return { system, user };
}
