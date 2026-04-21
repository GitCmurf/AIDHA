import { describe, expect, it } from 'vitest';
import {
  buildTranscriptProfile,
  decidePromptPack,
  determineRetryDecision,
} from '../src/extract/prompt-routing.js';

describe('prompt routing', () => {
  it('routes business content from topicDomain metadata', () => {
    const { decision } = decidePromptPack({
      topicDomain: 'Business Strategy',
      title: 'Consulting slide layouts',
      transcriptText: 'This transcript mentions principles and layouts.',
    });

    expect(decision.promptPackId).toBe('business-framework');
    expect(decision.routeSource).toBe('metadata');
  });

  it('routes clinical content from transcript profile when metadata is absent', () => {
    const { decision } = decidePromptPack({
      title: 'Lp(a) clinical management',
      transcriptText: 'LDL, ApoB, mg/dL, nmol/L, therapy, cardiovascular risk factor, aspirin.',
    });

    expect(decision.promptPackId).toBe('clinical-risk-management');
    expect(decision.routeSource).toBe('transcript-profile');
  });

  it('triggers an enumeration retry when list cues are present but no root claim is extracted', () => {
    const profile = buildTranscriptProfile('There are five slide layouts. The framework includes chart and subtitle slides.');
    const retry = determineRetryDecision({
      promptPackId: 'business-framework',
      profile,
      claims: [
        { text: 'Table slide layouts are useful for mixed qualitative and quantitative data.', excerptIds: ['e1'] },
        { text: 'Chart slides should match the data type.', excerptIds: ['e2'] },
      ],
    });

    expect(retry).toEqual({
      retry: true,
      retryReason: 'missing-root-claim',
      retryPromptPackId: 'enumeration-framework',
    });
  });
});
