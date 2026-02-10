import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryStore, SQLiteStore } from '../../src/store/index.js';
import type { GraphStore } from '../../src/store/types.js';

type StoreFactory = () => GraphStore;

function runGraphStoreContract(name: string, createStore: StoreFactory): void {
  describe(name, () => {
    let store: GraphStore;

    beforeEach(() => {
      store = createStore();
    });

    afterEach(async () => {
      await store.close();
    });

    it('upserts nodes with noop detection', async () => {
      const data = { label: 'Resource 1', content: 'Content', metadata: { source: 'test' } };
      const first = await store.upsertNode('Resource', 'node-1', data, { detectNoop: true });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.value.created).toBe(true);

      const second = await store.upsertNode('Resource', 'node-1', data, { detectNoop: true });
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.value.noop).toBe(true);
      expect(second.value.node.updatedAt).toBe(first.value.node.updatedAt);
    });

    it('orders query results deterministically and supports cursors', async () => {
      await store.upsertNode('Task', 'task-2', { label: 'Task 2' });
      await store.upsertNode('Area', 'area-1', { label: 'Area 1' });
      await store.upsertNode('Task', 'task-1', { label: 'Task 1' });

      const all = await store.queryNodes();
      expect(all.ok).toBe(true);
      if (!all.ok) return;
      const ids = all.value.items.map(node => `${node.type}:${node.id}`);
      expect(ids).toEqual(['Area:area-1', 'Task:task-1', 'Task:task-2']);

      const page1 = await store.queryNodes({ limit: 1 });
      expect(page1.ok).toBe(true);
      if (!page1.ok) return;
      const page2 = await store.queryNodes({ limit: 1, cursor: page1.value.nextCursor });
      expect(page2.ok).toBe(true);
      if (!page2.ok) return;
      expect(page2.value.items[0]?.id).toBe('task-1');
    });

    it('filters by metadata fields', async () => {
      await store.upsertNode('Resource', 'node-1', { label: 'Video', metadata: { videoId: 'v1' } });
      await store.upsertNode('Resource', 'node-2', { label: 'Other', metadata: { videoId: 'v2' } });

      const result = await store.queryNodes({ filters: { videoId: 'v1' } });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.items).toHaveLength(1);
      expect(result.value.items[0]?.id).toBe('node-1');
    });

    it('upserts edges with uniqueness and metadata updates', async () => {
      await store.upsertNode('Task', 't1', { label: 'Task 1' });
      await store.upsertNode('Task', 't2', { label: 'Task 2' });

      const first = await store.upsertEdge('t1', 'taskDependsOn', 't2', { metadata: { weight: 1 } }, { detectNoop: true });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.value.created).toBe(true);

      const second = await store.upsertEdge('t1', 'taskDependsOn', 't2', { metadata: { weight: 1 } }, { detectNoop: true });
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.value.noop).toBe(true);

      const third = await store.upsertEdge('t1', 'taskDependsOn', 't2', { metadata: { weight: 2 } }, { detectNoop: true });
      expect(third.ok).toBe(true);
      if (!third.ok) return;
      expect(third.value.updated).toBe(true);
    });

    it('orders edges deterministically', async () => {
      await store.upsertNode('Task', 't1', { label: 'Task 1' });
      await store.upsertNode('Task', 't2', { label: 'Task 2' });
      await store.upsertEdge('t2', 'relatedTo', 't1', {});
      await store.upsertEdge('t1', 'partOf', 't2', {});
      await store.upsertEdge('t1', 'relatedTo', 't2', {});

      const edges = await store.getEdges({});
      expect(edges.ok).toBe(true);
      if (!edges.ok) return;
      const order = edges.value.items.map(edge => `${edge.subject}|${edge.predicate}|${edge.object}`);
      expect(order).toEqual([
        't1|partOf|t2',
        't1|relatedTo|t2',
        't2|relatedTo|t1',
      ]);
    });

    it('deletes nodes with cascade', async () => {
      await store.upsertNode('Task', 't1', { label: 'Task 1' });
      await store.upsertNode('Task', 't2', { label: 'Task 2' });
      await store.upsertEdge('t1', 'taskDependsOn', 't2', {});

      const deleteResult = await store.deleteNode('t2', { cascade: true });
      expect(deleteResult.ok).toBe(true);

      const edges = await store.getEdges({});
      expect(edges.ok).toBe(true);
      if (!edges.ok) return;
      expect(edges.value.items).toHaveLength(0);
    });

    it('exports knowledge-only snapshots', async () => {
      await store.upsertNode('Project', 'proj-1', { label: 'Operational', metadata: { scope: 'operational' } });
      await store.upsertNode('Task', 'task-1', { label: 'Task 1' });
      await store.upsertEdge('task-1', 'taskPartOfProject', 'proj-1', {});

      const snapshot = await store.exportSnapshot({ scope: 'knowledge' });
      expect(snapshot.ok).toBe(true);
      if (!snapshot.ok) return;
      const ids = snapshot.value.nodes.map(node => node.id);
      expect(ids).not.toContain('proj-1');
      expect(snapshot.value.edges).toHaveLength(0);
    });

    it('returns graph stats with node/edge counts and top degree nodes', async () => {
      await store.upsertNode('Topic', 'topic-1', { label: 'Topic 1' });
      await store.upsertNode('Claim', 'claim-1', { label: 'Claim 1', metadata: { state: 'draft' } });
      await store.upsertNode('Claim', 'claim-2', { label: 'Claim 2', metadata: { state: 'accepted' } });
      await store.upsertNode('Resource', 'res-1', { label: 'Resource 1' });
      await store.upsertEdge('claim-1', 'aboutTag', 'topic-1', {});
      await store.upsertEdge('claim-2', 'aboutTag', 'topic-1', {});
      await store.upsertEdge('claim-1', 'claimDerivedFrom', 'res-1', {});

      const result = await store.getGraphStats({ topN: 2 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.nodeCounts['Topic']).toBe(1);
      expect(result.value.nodeCounts['Claim']).toBe(2);
      expect(result.value.nodeCounts['Resource']).toBe(1);
      expect(result.value.edgeCounts['aboutTag']).toBe(2);
      expect(result.value.edgeCounts['claimDerivedFrom']).toBe(1);
      expect(result.value.topDegreeNodes.length).toBeLessThanOrEqual(2);
      // claim-1 and topic-1 both have total degree 2; claim-1 wins alphabetically
      expect(result.value.topDegreeNodes[0]?.id).toBe('claim-1');
      expect(result.value.topDegreeNodes[0]?.outDegree).toBe(2);
      expect(result.value.topDegreeNodes[1]?.id).toBe('topic-1');
      expect(result.value.topDegreeNodes[1]?.inDegree).toBe(2);
      expect(result.value.claimStateCounts).toBeDefined();
      expect(result.value.claimStateCounts?.['draft']).toBe(1);
      expect(result.value.claimStateCounts?.['accepted']).toBe(1);
    });

    it('includes dangling edge endpoints in topDegreeNodes with type unknown', async () => {
      // Create one real node and edges that reference non-existent nodes
      await store.upsertNode('Topic', 'topic-1', { label: 'Topic 1' });
      // edge from existing node to non-existent node
      await store.upsertEdge('topic-1', 'relatedTo', 'ghost-1', {});
      // edge from non-existent node to existing node
      await store.upsertEdge('ghost-2', 'aboutTag', 'topic-1', {});
      // edge between two non-existent nodes
      await store.upsertEdge('ghost-1', 'partOf', 'ghost-3', {});

      const result = await store.getGraphStats({ topN: 10 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // nodeCounts should only count real nodes
      expect(result.value.nodeCounts['Topic']).toBe(1);
      expect(Object.values(result.value.nodeCounts).reduce((a, b) => a + b, 0)).toBe(1);

      // edgeCounts should count all edges (including dangling)
      expect(result.value.edgeCounts['relatedTo']).toBe(1);
      expect(result.value.edgeCounts['aboutTag']).toBe(1);
      expect(result.value.edgeCounts['partOf']).toBe(1);

      // topDegreeNodes must include dangling endpoints
      // topic-1: out=1 (relatedTo ghost-1), in=1 (ghost-2 aboutTag) => total=2
      // ghost-1: in=1 (topic-1 relatedTo), out=1 (partOf ghost-3) => total=2
      // ghost-2: out=1 (aboutTag topic-1) => total=1
      // ghost-3: in=1 (ghost-1 partOf) => total=1
      expect(result.value.topDegreeNodes.length).toBe(4);

      // Sorted by total desc, then id asc
      // ghost-1 (2) and topic-1 (2) tie; ghost-1 < topic-1 alphabetically
      expect(result.value.topDegreeNodes[0]?.id).toBe('ghost-1');
      expect(result.value.topDegreeNodes[0]?.type).toBe('unknown');
      expect(result.value.topDegreeNodes[0]?.inDegree).toBe(1);
      expect(result.value.topDegreeNodes[0]?.outDegree).toBe(1);

      expect(result.value.topDegreeNodes[1]?.id).toBe('topic-1');
      expect(result.value.topDegreeNodes[1]?.type).toBe('Topic');
      expect(result.value.topDegreeNodes[1]?.inDegree).toBe(1);
      expect(result.value.topDegreeNodes[1]?.outDegree).toBe(1);

      // ghost-2 (1) and ghost-3 (1) tie; ghost-2 < ghost-3
      expect(result.value.topDegreeNodes[2]?.id).toBe('ghost-2');
      expect(result.value.topDegreeNodes[2]?.type).toBe('unknown');
      expect(result.value.topDegreeNodes[2]?.outDegree).toBe(1);
      expect(result.value.topDegreeNodes[2]?.inDegree).toBe(0);

      expect(result.value.topDegreeNodes[3]?.id).toBe('ghost-3');
      expect(result.value.topDegreeNodes[3]?.type).toBe('unknown');
      expect(result.value.topDegreeNodes[3]?.inDegree).toBe(1);
      expect(result.value.topDegreeNodes[3]?.outDegree).toBe(0);
    });

    it('dangling edges respect topN limit with correct ordering', async () => {
      // Only dangling edges, no real nodes
      await store.upsertEdge('alpha', 'relatedTo', 'beta', {});
      await store.upsertEdge('beta', 'partOf', 'gamma', {});

      const result = await store.getGraphStats({ topN: 2 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // nodeCounts should be empty (no real nodes)
      expect(Object.keys(result.value.nodeCounts).length).toBe(0);

      // beta: in=1, out=1 => total=2; alpha: out=1 => total=1; gamma: in=1 => total=1
      expect(result.value.topDegreeNodes.length).toBe(2);
      expect(result.value.topDegreeNodes[0]?.id).toBe('beta');
      expect(result.value.topDegreeNodes[0]?.type).toBe('unknown');
      expect(result.value.topDegreeNodes[0]?.inDegree).toBe(1);
      expect(result.value.topDegreeNodes[0]?.outDegree).toBe(1);

      // alpha and gamma tie at 1; alpha < gamma alphabetically
      expect(result.value.topDegreeNodes[1]?.id).toBe('alpha');
      expect(result.value.topDegreeNodes[1]?.type).toBe('unknown');
    });

    it('exports Gephi CSV format with all nodes and edges', async () => {
      await store.upsertNode('Topic', 'topic-1', { label: 'Topic 1' });
      await store.upsertNode('Claim', 'claim-1', { label: 'Claim 1' });
      await store.upsertEdge('claim-1', 'aboutTag', 'topic-1', {});

      const result = await store.exportGephi();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.nodes).toHaveLength(2);
      expect(result.value.edges).toHaveLength(1);
      expect(result.value.edges[0]?.source).toBe('claim-1');
      expect(result.value.edges[0]?.target).toBe('topic-1');
      expect(result.value.edges[0]?.weight).toBe(1);
    });

    it('exports Gephi with predicate filter', async () => {
      await store.upsertNode('Topic', 'topic-1', { label: 'Topic 1' });
      await store.upsertNode('Claim', 'claim-1', { label: 'Claim 1' });
      await store.upsertNode('Resource', 'res-1', { label: 'Resource 1' });
      await store.upsertEdge('claim-1', 'aboutTag', 'topic-1', {});
      await store.upsertEdge('claim-1', 'claimDerivedFrom', 'res-1', {});

      const result = await store.exportGephi({ predicates: ['aboutTag'] });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.edges).toHaveLength(1);
      expect(result.value.edges[0]?.predicate).toBe('aboutTag');
      // Only nodes referenced by the filtered edges
      const nodeIds = result.value.nodes.map(n => n.id).sort();
      expect(nodeIds).toEqual(['claim-1', 'topic-1']);
    });

    it('exports Gephi with node type filter — edges filtered to match', async () => {
      await store.upsertNode('Topic', 'topic-1', { label: 'Topic 1' });
      await store.upsertNode('Claim', 'claim-1', { label: 'Claim 1' });
      await store.upsertNode('Claim', 'claim-2', { label: 'Claim 2' });
      await store.upsertNode('Resource', 'res-1', { label: 'Resource 1' });
      await store.upsertEdge('claim-1', 'aboutTag', 'topic-1', {});
      await store.upsertEdge('claim-1', 'claimDerivedFrom', 'res-1', {});
      await store.upsertEdge('claim-2', 'aboutTag', 'topic-1', {});
      await store.upsertEdge('claim-2', 'relatedTo', 'claim-1', {});

      // Filter to only Claim nodes — edges between Claims are kept, cross-type edges are excluded
      const result = await store.exportGephi({ nodeTypes: ['Claim'] });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.nodes).toHaveLength(2);
      expect(result.value.nodes.every(n => n.type === 'Claim')).toBe(true);
      // Only the claim-2 → claim-1 edge should survive (both endpoints are Claim)
      expect(result.value.edges).toHaveLength(1);
      expect(result.value.edges[0]?.source).toBe('claim-2');
      expect(result.value.edges[0]?.target).toBe('claim-1');
    });

    it('exports Gephi with multi-type nodeTypes filter — edges filtered to match', async () => {
      await store.upsertNode('Topic', 'topic-1', { label: 'Topic 1' });
      await store.upsertNode('Claim', 'claim-1', { label: 'Claim 1' });
      await store.upsertNode('Resource', 'res-1', { label: 'Resource 1' });
      await store.upsertEdge('claim-1', 'aboutTag', 'topic-1', {});
      await store.upsertEdge('claim-1', 'claimDerivedFrom', 'res-1', {});

      // Filter to Claim + Topic — edge claim-1→topic-1 kept, claim-1→res-1 excluded
      const result = await store.exportGephi({ nodeTypes: ['Claim', 'Topic'] });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const nodeIds = result.value.nodes.map(n => n.id).sort();
      expect(nodeIds).toEqual(['claim-1', 'topic-1']);
      expect(result.value.edges).toHaveLength(1);
      expect(result.value.edges[0]?.source).toBe('claim-1');
      expect(result.value.edges[0]?.target).toBe('topic-1');
    });

    it('exports Gephi with combined predicates + nodeTypes — both filters applied', async () => {
      await store.upsertNode('Topic', 'topic-1', { label: 'Topic 1' });
      await store.upsertNode('Claim', 'claim-1', { label: 'Claim 1' });
      await store.upsertNode('Claim', 'claim-2', { label: 'Claim 2' });
      await store.upsertNode('Resource', 'res-1', { label: 'Resource 1' });
      await store.upsertEdge('claim-1', 'aboutTag', 'topic-1', {});
      await store.upsertEdge('claim-1', 'claimDerivedFrom', 'res-1', {});
      await store.upsertEdge('claim-2', 'relatedTo', 'claim-1', {});

      // predicate=aboutTag narrows edges, nodeTypes=['Claim','Topic'] narrows nodes
      // aboutTag edges: claim-1→topic-1; both Claim and Topic pass nodeTypes → 1 edge, 2 nodes
      const result = await store.exportGephi({ predicates: ['aboutTag'], nodeTypes: ['Claim', 'Topic'] });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.edges).toHaveLength(1);
      expect(result.value.edges[0]?.predicate).toBe('aboutTag');
      const nodeIds = result.value.nodes.map(n => n.id).sort();
      expect(nodeIds).toEqual(['claim-1', 'topic-1']);
    });

    it('exports Gephi with combined predicates + nodeTypes — no surviving edges', async () => {
      await store.upsertNode('Topic', 'topic-1', { label: 'Topic 1' });
      await store.upsertNode('Claim', 'claim-1', { label: 'Claim 1' });
      await store.upsertEdge('claim-1', 'aboutTag', 'topic-1', {});

      // predicate=aboutTag selects claim-1→topic-1, but nodeTypes=['Claim'] excludes topic-1
      // So the edge has no valid target → 0 edges, and only claim-1 node if referenced
      const result = await store.exportGephi({ predicates: ['aboutTag'], nodeTypes: ['Claim'] });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.edges).toHaveLength(0);
      // claim-1 is referenced by predicate-filtered edge AND passes nodeTypes, so it's included
      expect(result.value.nodes).toHaveLength(1);
      expect(result.value.nodes[0]?.id).toBe('claim-1');
    });

    it('exports Gephi with nodeTypes matching no nodes — empty result', async () => {
      await store.upsertNode('Topic', 'topic-1', { label: 'Topic 1' });
      await store.upsertNode('Claim', 'claim-1', { label: 'Claim 1' });
      await store.upsertEdge('claim-1', 'aboutTag', 'topic-1', {});

      const result = await store.exportGephi({ nodeTypes: ['Resource'] });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.nodes).toHaveLength(0);
      expect(result.value.edges).toHaveLength(0);
    });

    it('exports Gephi with includeLabels', async () => {
      await store.upsertNode('Topic', 'topic-1', { label: 'My Topic' });

      const withLabels = await store.exportGephi({ includeLabels: true });
      expect(withLabels.ok).toBe(true);
      if (!withLabels.ok) return;
      expect(withLabels.value.nodes[0]?.label).toBe('My Topic');

      const withoutLabels = await store.exportGephi({ includeLabels: false });
      expect(withoutLabels.ok).toBe(true);
      if (!withoutLabels.ok) return;
      expect(withoutLabels.value.nodes[0]?.label).toBeUndefined();
    });
  });
}

runGraphStoreContract('InMemoryStore', () => new InMemoryStore());
runGraphStoreContract('SQLiteStore', () => SQLiteStore.createInMemory());

describe('SQLiteStore VIEWs', () => {
  let store: SQLiteStore;

  beforeEach(() => {
    store = SQLiteStore.createInMemory();
  });

  afterEach(async () => {
    await store.close();
  });

  it('v_nodes returns denormalized node data', async () => {
    await store.upsertNode('Claim', 'claim-1', {
      label: 'Test Claim',
      metadata: { state: 'draft', videoId: 'v1' },
    });
    const rows = (store as unknown as { db: { prepare: (sql: string) => { all: () => unknown[] } } })
      .db.prepare('SELECT * FROM v_nodes WHERE id = ?').all('claim-1' as never) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['type']).toBe('Claim');
    expect(rows[0]?.['state']).toBe('draft');
    expect(rows[0]?.['videoId']).toBe('v1');
  });

  it('v_edges returns denormalized edge data', async () => {
    await store.upsertNode('Topic', 'topic-1', { label: 'Topic 1' });
    await store.upsertNode('Claim', 'claim-1', { label: 'Claim 1' });
    await store.upsertEdge('claim-1', 'aboutTag', 'topic-1', {});
    const rows = (store as unknown as { db: { prepare: (sql: string) => { all: () => unknown[] } } })
      .db.prepare('SELECT * FROM v_edges').all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['subject']).toBe('claim-1');
    expect(rows[0]?.['predicate']).toBe('aboutTag');
    expect(rows[0]?.['object']).toBe('topic-1');
  });

  it('v_claims_with_sources joins claims to their sources', async () => {
    await store.upsertNode('Resource', 'res-1', { label: 'Video Transcript' });
    await store.upsertNode('Claim', 'claim-1', {
      label: 'Test Claim',
      content: 'Content here',
      metadata: { state: 'accepted', videoId: 'v1' },
    });
    await store.upsertEdge('claim-1', 'claimDerivedFrom', 'res-1', {});
    const rows = (store as unknown as { db: { prepare: (sql: string) => { all: () => unknown[] } } })
      .db.prepare('SELECT * FROM v_claims_with_sources').all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['claimId']).toBe('claim-1');
    expect(rows[0]?.['state']).toBe('accepted');
    expect(rows[0]?.['sourceId']).toBe('res-1');
    expect(rows[0]?.['sourceLabel']).toBe('Video Transcript');
    expect(rows[0]?.['sourceType']).toBe('Resource');
  });
});
