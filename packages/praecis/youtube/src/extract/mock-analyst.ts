import type { ClaimCandidate } from './types.js';

/**
 * Mock data representing the high-resolution "Senior Analyst" output
 * for video h_1zlead9ZU.
 */
export const HIGH_RES_MOCK_CLAIMS: ClaimCandidate[] = [
  {
    text: "Muscle protein synthesis (MPS) does not plateau at 25-30g; 100g of slow-digesting protein elicits significantly greater MPS than 25g.",
    excerptIds: ["mock-excerpt-mps"],
    startSeconds: 381,
    classification: "fact",
    domain: "Protein Kinetics",
    confidence: 0.95,
    method: "llm"
  },
  {
    text: "If total daily protein reaches ~1.6g/kg (0.7g/lb), precise timing relative to training is statistically irrelevant to hypertrophy.",
    excerptIds: ["mock-excerpt-timing"],
    startSeconds: 805,
    classification: "fact",
    domain: "Protein Kinetics",
    confidence: 0.92,
    method: "llm"
  },
  {
    text: "Cream is lipid-neutral due to the presence of Milk Fat Globule Membrane (MFGM), whereas butter raises LDL cholesterol due to its removal during churning.",
    excerptIds: ["mock-excerpt-butter"],
    startSeconds: 6968,
    classification: "fact",
    domain: "Lipidology",
    confidence: 0.88,
    method: "llm"
  },
  {
    text: "A single resistance bout elevates muscle protein synthesis for 24-72 hours, rendering the acute 30-60 minute post-exercise feeding window obsolete.",
    excerptIds: ["mock-excerpt-window"],
    startSeconds: 909,
    classification: "fact",
    domain: "Protein Kinetics",
    confidence: 0.94,
    method: "llm"
  },
  {
    text: "Ketogenic and high-carb diets yield identical fat loss when calories and protein are equated; keto's efficacy stems primarily from spontaneous caloric restriction.",
    excerptIds: ["mock-excerpt-keto"],
    startSeconds: 4027,
    classification: "fact",
    domain: "Bioenergetics",
    confidence: 0.96,
    method: "llm"
  },
  {
    text: "The average compositional shift across the menopausal transition is strictly ~1.6 kg fat gain and 0.2 kg lean mass loss, refuting claims of severe metabolic destruction.",
    excerptIds: ["mock-excerpt-menopause"],
    startSeconds: 7481,
    classification: "fact",
    domain: "Endocrinology",
    confidence: 0.91,
    method: "llm"
  }
];
