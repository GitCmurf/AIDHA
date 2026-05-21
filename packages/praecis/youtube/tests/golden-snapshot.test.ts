/**
 * Phase 0 golden snapshot regression gate.
 *
 * Captures dossier + transcript exports pre-schema-change (plan-007 §8 Phase 0).
 * Semantic-equivalence check after CP-0d re-wire: same claims, provenance, deep-link targets.
 *
 * To regenerate: UPDATE_GOLDEN=1 pnpm test golden-snapshot
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { InMemoryStore } from '@aidha/graph-backend';
import { InMemoryRegistry } from '@aidha/taxonomy';
import { MockYouTubeClient } from '../src/client/mock.js';
import { IngestionPipeline } from '../src/pipeline/ingest.js';
import { ClaimExtractionPipeline } from '../src/extract/claims.js';
import { ReferenceExtractionPipeline } from '../src/extract/references.js';
import { DossierExporter } from '../src/export/dossier.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = join(__dirname, '__golden__');
const UPDATE = process.env['UPDATE_GOLDEN'] === '1';

async function buildGoldenOutputs(): Promise<{
  dossierMd: string;
  transcriptJson: string;
}> {
  const graphStore = new InMemoryStore();
  const taxonomyRegistry = new InMemoryRegistry();
  const youtubeClient = new MockYouTubeClient();

  const ingestion = new IngestionPipeline({ graphStore, taxonomyRegistry, youtubeClient });
  const ingestResult = await ingestion.ingestPlaylist('test-playlist');
  if (!ingestResult.ok) throw ingestResult.error;

  const claimPipeline = new ClaimExtractionPipeline({ graphStore });
  const claimResult = await claimPipeline.extractClaimsForVideo('test-video');
  if (!claimResult.ok) throw claimResult.error;

  const refPipeline = new ReferenceExtractionPipeline({ graphStore });
  const refResult = await refPipeline.extractReferencesForVideo('test-video');
  if (!refResult.ok) throw refResult.error;

  const exporter = new DossierExporter({ graphStore });

  const dossierResult = await exporter.renderVideoDossier('test-video', { states: ['accepted', 'draft'] });
  if (!dossierResult.ok) throw dossierResult.error;

  const transcriptResult = await exporter.exportTranscriptJson('test-video');
  if (!transcriptResult.ok) throw transcriptResult.error;

  await graphStore.close();
  await taxonomyRegistry.close();

  return {
    dossierMd: dossierResult.value,
    transcriptJson: transcriptResult.value,
  };
}

describe('Phase 0 golden snapshot (plan-007)', () => {
  it('dossier markdown matches committed golden file (or writes it when UPDATE_GOLDEN=1)', async () => {
    const { dossierMd } = await buildGoldenOutputs();
    const goldenPath = join(GOLDEN_DIR, 'video-dossier.md');

    if (UPDATE) {
      await writeFile(goldenPath, dossierMd, 'utf-8');
      console.log(`[golden-snapshot] Wrote ${goldenPath}`);
      return;
    }

    const committed = await readFile(goldenPath, 'utf-8');
    expect(dossierMd).toBe(committed);
  });

  it('transcript JSON matches committed golden file (or writes it when UPDATE_GOLDEN=1)', async () => {
    const { transcriptJson } = await buildGoldenOutputs();
    const goldenPath = join(GOLDEN_DIR, 'transcript.json');

    if (UPDATE) {
      await writeFile(goldenPath, transcriptJson, 'utf-8');
      console.log(`[golden-snapshot] Wrote ${goldenPath}`);
      return;
    }

    const committed = await readFile(goldenPath, 'utf-8');
    expect(transcriptJson).toBe(committed);
  });
});
