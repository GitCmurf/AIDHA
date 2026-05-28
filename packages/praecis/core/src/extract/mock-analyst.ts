import type { ClaimCandidate } from './types.js';

/**
 * Mock data representing the high-resolution "Senior Analyst" output
 * for the synthetic benchmark fixture.
 */
export const HIGH_RES_MOCK_CLAIMS: ClaimCandidate[] = [
  {
    text: "A benchmark can separate claim-worthy statements from boilerplate and fragmentary speech.",
    excerptIds: ["mock-excerpt-filtering"],
    startSeconds: 60,
    classification: "fact",
    domain: "Methodology",
    confidence: 0.95,
    method: "llm"
  },
  {
    text: "Synthetic panel data should preserve speaker turns when the transcript alternates quickly between panelists.",
    excerptIds: ["mock-excerpt-panel-turns"],
    startSeconds: 300,
    classification: "fact",
    domain: "Methodology",
    confidence: 0.92,
    method: "llm"
  },
  {
    text: "Show-note citations should be extracted when they are explicitly stated in the transcript.",
    excerptIds: ["mock-excerpt-citations"],
    startSeconds: 900,
    classification: "fact",
    domain: "Methodology",
    confidence: 0.88,
    method: "llm"
  },
  {
    text: "Concise claims should remain atomic rather than being merged into one summary sentence.",
    excerptIds: ["mock-excerpt-atomicity"],
    startSeconds: 1200,
    classification: "fact",
    domain: "Methodology",
    confidence: 0.94,
    method: "llm"
  },
  {
    text: "Longer reasoning chains should still preserve the original claim order.",
    excerptIds: ["mock-excerpt-order"],
    startSeconds: 1500,
    classification: "fact",
    domain: "Methodology",
    confidence: 0.96,
    method: "llm"
  },
  {
    text: "Sponsor copy should be rejected even when it is grammatically complete.",
    excerptIds: ["mock-excerpt-sponsor"],
    startSeconds: 1800,
    classification: "fact",
    domain: "Methodology",
    confidence: 0.91,
    method: "llm"
  }
];
