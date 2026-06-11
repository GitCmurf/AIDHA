import { describe, expect, it } from 'vitest';
import { applyClaimQualityAssessment, assessClaimQuality } from '../../src/extract/index.js';
import type { ClaimCandidate } from '../../src/extract/index.js';

const pkmEvidence = [
  'The source explains a markdown wiki with raw and wiki folders. It says the agent reads index files and follows explicit links instead of using embedding similarity over chunks.',
];

function candidate(overrides: Partial<ClaimCandidate>): ClaimCandidate {
  return {
    text: 'A markdown wiki built from raw source files can answer questions by reading index files and following explicit links instead of using embedding similarity over chunks.',
    excerptIds: ['ex1'],
    type: 'mechanism',
    classification: 'insight',
    domain: 'Knowledge Systems',
    supportSummary: 'The source contrasts markdown index and link traversal with embedding-based semantic search.',
    rationale: 'Explicit links preserve authored relationships that similarity search may only approximate.',
    ...overrides,
  };
}

describe('assessClaimQuality', () => {
  it('marks source-faithful claims as reviewable but not trusted', () => {
    const assessment = assessClaimQuality({
      candidate: candidate({}),
      evidenceTexts: pkmEvidence,
    });

    expect(assessment.qualityStatus).toBe('reviewable');
    expect(assessment.trusted).toBe(false);
    expect(assessment.qualityReasons).toEqual([]);
    expect(assessment.supportCoverage).toBeGreaterThan(0);
  });

  it('rejects academic domain drift that is not supported by the source', () => {
    const assessment = assessClaimQuality({
      candidate: candidate({
        text: "Structuring information into linked nodes decreases reliance on working memory by offloading ephemeral storage into externalized long-term repositories.",
        domain: 'Working Memory / Cognitive Neuroscience',
        supportSummary: 'The source shows videos organized into linked nodes and backlinks.',
        rationale: 'The useful implication is reduced cognitive load during retrieval.',
      }),
      evidenceTexts: [
        'The source shows 36 YouTube videos organized into a knowledge system with tags, raw files, explanations, and backlinks.',
      ],
    });

    expect(assessment.qualityStatus).toBe('rejected');
    expect(assessment.qualityReasons).toContain('domain_drift');
    expect(assessment.qualityReasons).toContain('unsupported_inference');
  });

  it('rejects claims without concrete source support', () => {
    const assessment = assessClaimQuality({
      candidate: candidate({
        supportSummary: undefined,
      }),
      evidenceTexts: pkmEvidence,
    });

    expect(assessment.qualityStatus).toBe('rejected');
    expect(assessment.qualityReasons).toContain('missing_support');
  });

  it('rejects category-soup backlink lists', () => {
    const assessment = assessClaimQuality({
      candidate: candidate({
        text: 'The speaker uses backlinks in the knowledge system to navigate between concepts such as the WAT framework, Claude Code, Perplexity, Visual Studio Code, Nano Banana, and permission modes.',
        supportSummary: 'The transcript lists backlinks in the vault.',
        rationale: 'The source treats the list as navigation context.',
      }),
      evidenceTexts: [
        'The backlinks include WAT framework, Claude Code, Perplexity, Visual Studio Code, Nano Banana, and permission modes.',
      ],
    });

    expect(assessment.qualityStatus).toBe('rejected');
    expect(assessment.qualityReasons).toContain('category_soup');
  });

  it('rejects recommendations without an explicit rationale field', () => {
    const assessment = assessClaimQuality({
      candidate: candidate({
        text: 'For larger systems, users should prefer traditional RAG rather than a markdown-wiki file crawl.',
        type: 'warning',
        classification: 'warning',
        supportSummary: 'The source says file crawling and token usage become bottlenecks at scale.',
        rationale: undefined,
      }),
      evidenceTexts: [
        'For million-document systems, traditional RAG is better because file crawling and token usage scale poorly.',
      ],
    });

    expect(assessment.qualityStatus).toBe('rejected');
    expect(assessment.qualityReasons).toContain('weak_rationale');
  });

  it('rejects reported-speech wrappers', () => {
    const assessment = assessClaimQuality({
      candidate: candidate({
        text: 'The speaker claims that Claude Code can organize source files into a linked markdown wiki.',
        supportSummary: 'The transcript states that Claude Code organizes source files into wiki pages.',
      }),
      evidenceTexts: [
        'Claude Code organizes source files into wiki pages with links and indexes.',
      ],
    });

    expect(assessment.qualityStatus).toBe('rejected');
    expect(assessment.qualityReasons).toContain('reported_speech');
  });

  it('treats generic support summaries as missing support', () => {
    const assessment = assessClaimQuality({
      candidate: candidate({
        supportSummary: 'Direct report from the speaker.',
      }),
      evidenceTexts: pkmEvidence,
    });

    expect(assessment.qualityStatus).toBe('rejected');
    expect(assessment.qualityReasons).toContain('missing_support');
  });

  it('rejects short or fragmentary prose', () => {
    const assessment = assessClaimQuality({
      candidate: candidate({
        text: 'Raw wiki links.',
        supportSummary: 'The transcript mentions raw files and wiki links.',
      }),
      evidenceTexts: pkmEvidence,
    });

    expect(assessment.qualityStatus).toBe('rejected');
    expect(assessment.qualityReasons).toContain('poor_prose');
  });

  it('rejects unsupported inference-verb claims with weak evidence overlap', () => {
    const assessment = assessClaimQuality({
      candidate: candidate({
        text: 'A markdown wiki reduces enterprise retrieval latency by optimizing organizational search workflows.',
        supportSummary: 'The source says the system uses markdown wiki files and links.',
        rationale: 'The claim asserts a performance effect that the cited source does not establish.',
      }),
      evidenceTexts: [
        'The system uses markdown wiki files, raw folders, index files, and explicit links.',
      ],
    });

    expect(assessment.qualityStatus).toBe('rejected');
    expect(assessment.qualityReasons).toContain('unsupported_inference');
    expect(assessment.supportCoverage).toBeLessThan(0.2);
  });

  it('clamps quality scores and reports support coverage boundaries', () => {
    const noEvidence = assessClaimQuality({
      candidate: candidate({
        supportSummary: undefined,
      }),
      evidenceTexts: [],
    });

    expect(noEvidence.supportCoverage).toBe(0);
    expect(noEvidence.qualityScore).toBe(0);

    const fullEvidence = assessClaimQuality({
      candidate: candidate({
        text: 'Claude Code organizes raw source files into linked markdown wiki pages for later navigation.',
        supportSummary: 'The evidence contains the same source-file, linked-markdown-wiki, and navigation terms.',
      }),
      evidenceTexts: [
        'Claude Code organizes raw source files into linked markdown wiki pages for later navigation.',
      ],
    });

    expect(fullEvidence.supportCoverage).toBe(1);
    expect(fullEvidence.qualityScore).toBe(1);
  });

  it('copies quality assessment fields onto a claim candidate', () => {
    const base = candidate({});
    const applied = applyClaimQualityAssessment(base, {
      qualityStatus: 'rejected',
      trusted: false,
      qualityScore: 0.27,
      qualityReasons: ['missing_support', 'unsupported_inference'],
      supportCoverage: 0.13,
    });

    expect(applied).toMatchObject({
      qualityStatus: 'rejected',
      trusted: false,
      qualityScore: 0.27,
      qualityReasons: ['missing_support', 'unsupported_inference'],
      supportCoverage: 0.13,
    });
    expect(applied.text).toBe(base.text);
  });
});
