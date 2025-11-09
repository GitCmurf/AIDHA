// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

/**
 * JSON-LD export module.
 *
 * Converts graph data to JSON-LD format for interoperability.
 */
import type { GraphNode, GraphEdge } from '../schema/index.js';
import { Predicate } from '../schema/index.js';

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
    'resourceHasExcerpt': { '@type': '@id' },
    'claimDerivedFrom': { '@type': '@id' },
    'claimMentionsReference': { '@type': '@id' },
    'aboutTag': { '@type': '@id' },
    'taskMotivatedBy': { '@type': '@id' },
    'taskPartOfProject': { '@type': '@id' },
    'projectServesGoal': { '@type': '@id' },
    'projectInArea': { '@type': '@id' },
    'taskDependsOn': { '@type': '@id' },
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

function sortPredicateArrays(nodes: Map<string, JsonLdNode>): void {
  const predicateKeys = new Set(Predicate.options);
  for (const node of nodes.values()) {
    for (const key of predicateKeys) {
      const value = node[key];
      if (Array.isArray(value)) {
        value.sort((a, b) => String(a).localeCompare(String(b)));
      }
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
  const nodeMap = new Map<string, JsonLdNode>();
  const sortedNodes = nodes.slice().sort((a, b) => a.id.localeCompare(b.id));
  for (const node of sortedNodes) {
    const jsonLdNode = nodeToJsonLd(node);
    nodeMap.set(node.id, jsonLdNode);
  }

  const sortedEdges = edges.slice().sort((a, b) => {
    const subjectCompare = a.subject.localeCompare(b.subject);
    if (subjectCompare !== 0) return subjectCompare;
    const predicateCompare = a.predicate.localeCompare(b.predicate);
    if (predicateCompare !== 0) return predicateCompare;
    return a.object.localeCompare(b.object);
  });

  applyEdgesToNodes(nodeMap, sortedEdges);
  sortPredicateArrays(nodeMap);

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
