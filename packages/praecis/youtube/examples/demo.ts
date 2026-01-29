/**
 * Demo: Full ingestion pipeline with your test video
 *
 * Shows:
 * 1. Key points from the video transcript
 * 2. How content maps to taxonomy
 * 3. How it's stored in the graph database
 */
import { InMemoryStore } from '@aidha/graph-backend';
import { InMemoryRegistry } from '@aidha/taxonomy';
import { RealYouTubeClient, IngestionPipeline } from '../src/index.js';

async function demo() {
  console.log('='.repeat(60));
  console.log('AIDHA YouTube Ingestion Demo');
  console.log('='.repeat(60));

  // 1. Setup taxonomy (categories, topics, tags)
  console.log('\n📚 STEP 1: Setting up taxonomy...\n');

  const taxonomy = new InMemoryRegistry();

  // Categories
  await taxonomy.addCategory({ id: 'philosophy', name: 'Philosophy' });
  await taxonomy.addCategory({ id: 'science', name: 'Science' });

  // Topics
  await taxonomy.addTopic({ id: 'metaphysics', name: 'Metaphysics', categoryId: 'philosophy' });
  await taxonomy.addTopic({ id: 'epistemology', name: 'Epistemology', categoryId: 'philosophy' });
  await taxonomy.addTopic({ id: 'mathematics', name: 'Mathematics', categoryId: 'science' });

  // Tags with aliases for matching
  await taxonomy.addTag({
    id: 'math',
    name: 'mathematics',
    topicIds: ['mathematics'],
    aliases: ['math', '2 + 2', 'equation', 'arithmetic']
  });
  await taxonomy.addTag({
    id: 'reality',
    name: 'reality',
    topicIds: ['metaphysics'],
    aliases: ['real', 'existence', 'nature of reality']
  });
  await taxonomy.addTag({
    id: 'philosophy',
    name: 'philosophy',
    topicIds: ['epistemology', 'metaphysics'],
    aliases: ['philosophical', 'philosopher']
  });
  await taxonomy.addTag({
    id: 'logic',
    name: 'logic',
    topicIds: ['mathematics', 'epistemology'],
    aliases: ['logical', 'reasoning', 'proof']
  });

  console.log('Created taxonomy:');
  console.log('  Categories: Philosophy, Science');
  console.log('  Topics: Metaphysics, Epistemology, Mathematics');
  console.log('  Tags: mathematics, reality, philosophy, logic');

  // 2. Fetch video and transcript
  console.log('\n🎬 STEP 2: Fetching video transcript...\n');

  const client = new RealYouTubeClient();
  const videoResult = await client.fetchVideoWithTranscript('bY3ZMOn9mHQ');

  if (!videoResult.ok) {
    console.error('Failed to fetch video:', videoResult.error.message);
    return;
  }

  const { video, transcript } = videoResult.value;

  console.log(`Title: ${video.title}`);
  console.log(`Channel: ${video.channelName}`);
  console.log(`Transcript segments: ${transcript?.segments.length ?? 0}`);

  // 3. Extract key points from transcript
  console.log('\n📝 STEP 3: Key points from transcript...\n');

  if (transcript) {
    const fullText = transcript.fullText;

    // Simple extraction - first few meaningful sentences
    const sentences = fullText.split(/[.?!]/).filter(s => s.trim().length > 20).slice(0, 8);
    sentences.forEach((s, i) => {
      console.log(`  ${i + 1}. ${s.trim().slice(0, 80)}...`);
    });

    console.log(`\n  Total transcript: ${fullText.length} characters`);
  }

  // 4. Run ingestion pipeline
  console.log('\n🔄 STEP 4: Running ingestion pipeline...\n');

  const graphStore = new InMemoryStore();

  // Manually ingest the video (since we already have it)
  const nodeResult = await graphStore.upsertNode(
    'Resource',
    `youtube-${video.id}`,
    {
      label: video.title,
      content: transcript?.fullText,
      metadata: {
        videoId: video.id,
        channelName: video.channelName,
        source: 'youtube',
        thumbnailUrl: video.thumbnailUrl,
      },
    },
    { detectNoop: true }
  );

  if (!nodeResult.ok) {
    console.error('Failed to create node:', nodeResult.error.message);
    return;
  }

  console.log('Created graph node:', nodeResult.value.node.id);

  // 5. Map to taxonomy (keyword matching)
  console.log('\n🏷️  STEP 5: Mapping to taxonomy tags...\n');

  const contentLower = transcript?.fullText.toLowerCase() ?? '';
  const tagsResult = await taxonomy.listTags();

  if (tagsResult.ok) {
    let assignedCount = 0;
    for (const tag of tagsResult.value) {
      const matches =
        contentLower.includes(tag.name.toLowerCase()) ||
        tag.aliases.some(alias => contentLower.includes(alias.toLowerCase()));

      if (matches) {
        await taxonomy.assignTag({
          nodeId: nodeResult.value.node.id,
          tagId: tag.id,
          confidence: 0.8,
          source: 'automatic',
        });
        console.log(`  ✓ Tagged with: ${tag.name}`);
        assignedCount++;
      }
    }
    console.log(`\n  Total tags assigned: ${assignedCount}`);
  }

  // 6. Show what's stored in the database
  console.log('\n💾 STEP 6: What is stored in the graph database...\n');

  const storedNodes = await graphStore.queryNodes();
  if (storedNodes.ok) {
    for (const node of storedNodes.value.items) {
      console.log('Node:');
      console.log(`  ID: ${node.id}`);
      console.log(`  Type: ${node.type}`);
      console.log(`  Label: ${node.label}`);
      console.log(`  Content length: ${node.content?.length ?? 0} chars`);
      console.log(`  Metadata:`, JSON.stringify(node.metadata, null, 4));

      // Show assigned tags
      const assignments = await taxonomy.getAssignments(node.id);
      if (assignments.ok && assignments.value.length > 0) {
        console.log('  Assigned tags:');
        for (const a of assignments.value) {
          const tagResult = await taxonomy.getTag(a.tagId);
          const tagName = tagResult.ok && tagResult.value ? tagResult.value.name : a.tagId;
          console.log(`    - ${tagName} (confidence: ${a.confidence}, source: ${a.source})`);
        }
      }
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('Demo complete!');
  console.log('='.repeat(60));

  // Cleanup
  await graphStore.close();
  await taxonomy.close();
}

demo().catch(console.error);
