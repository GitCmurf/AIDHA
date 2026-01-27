/**
 * JSON-LD export module.
 *
 * Converts graph data to JSON-LD format for interoperability.
 */
import type { GraphNode, GraphEdge } from '../schema/index.js';

/**
 * JSON-LD context for AIDHA graph exports.
 */
export const JSONLD_CONTEXT = {
  '@context': {
    '@vocab': 'https://aidha.dev/graph/',
    'schema': 'https://schema.org/',
    'id': '@id',
    'type': '@type',
    'label': 'schema:name',
    'content': 'schema:description',
    'createdAt': {
      '@id': 'schema:dateCreated',
      '@type': 'schema:DateTime',
    },
    'updatedAt': {
      '@id': 'schema:dateModified',
      '@type': 'schema:DateTime',
    },
    'relatedTo': { '@type': '@id' },
    'partOf': { '@type': '@id' },
    'references': { '@type': '@id' },
    'derivedFrom': { '@type': '@id' },
    'createdBy': { '@type': '@id' },
    'taggedWith': { '@type': '@id' },
    'supersedes': { '@type': '@id' },
  },
} as const;

/**
 * JSON-LD node representation.
 */
export interface JsonLdNode {
  '@id': string;
  '@type': string;
  label: string;
  content?: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

/**
 * JSON-LD graph document structure.
 */
export interface JsonLdDocument {
  '@context': typeof JSONLD_CONTEXT['@context'];
  '@graph': JsonLdNode[];
}

/**
 * Convert a GraphNode to JSON-LD format.
 */
export function nodeToJsonLd(node: GraphNode): JsonLdNode {
  return {
    '@id': `urn:aidha:node:${node.id}`,
    '@type': node.type,
    label: node.label,
    ...(node.content && { content: node.content }),
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    ...node.metadata,
  };
}

/**
 * Apply edges to JSON-LD nodes by adding relationship properties.
 */
function applyEdgesToNodes(
  nodes: Map<string, JsonLdNode>,
  edges: GraphEdge[]
): void {
  for (const edge of edges) {
    const sourceNode = nodes.get(edge.subject);
    if (!sourceNode) continue;

    const targetUri = `urn:aidha:node:${edge.object}`;

    // Add relationship as property
    const existing = sourceNode[edge.predicate];
    if (Array.isArray(existing)) {
      existing.push(targetUri);
    } else if (existing) {
      sourceNode[edge.predicate] = [existing, targetUri];
    } else {
      sourceNode[edge.predicate] = targetUri;
    }
  }
}

/**
 * Export graph data to JSON-LD format.
 *
 * @param nodes - Array of graph nodes
 * @param edges - Array of graph edges (optional)
 * @returns JSON-LD document
 */
export function toJsonLd(nodes: GraphNode[], edges: GraphEdge[] = []): JsonLdDocument {
  // Convert nodes to JSON-LD format
  const nodeMap = new Map<string, JsonLdNode>();
  for (const node of nodes) {
    const jsonLdNode = nodeToJsonLd(node);
    nodeMap.set(node.id, jsonLdNode);
  }

  // Apply edges as relationships
  applyEdgesToNodes(nodeMap, edges);

  return {
    '@context': JSONLD_CONTEXT['@context'],
    '@graph': Array.from(nodeMap.values()),
  };
}

/**
 * Serialize JSON-LD document to string.
 */
export function serializeJsonLd(doc: JsonLdDocument, pretty = true): string {
  return pretty ? JSON.stringify(doc, null, 2) : JSON.stringify(doc);
}
