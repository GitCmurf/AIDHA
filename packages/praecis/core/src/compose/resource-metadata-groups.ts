// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import type { RawSource, ResourceMetadataGroup } from '../types/index.js';

/** Internal Resource metadata reserved for source-owned group membership. */
export const SOURCE_OWNED_METADATA_GROUPS_KEY = 'sourceOwnedMetadataGroups';

const RESERVED_FIELDS = new Set([
  'canonicalId',
  'sourceType',
  'dedupKeys',
  'provenances',
  'label',
  'metadataConflicts',
  SOURCE_OWNED_METADATA_GROUPS_KEY,
]);

interface OwnedGroup {
  readonly canonicalId: string;
  readonly fields: readonly string[];
}

interface OwnedGroupsMetadata {
  readonly schemaVersion: 1;
  readonly groups: Readonly<Record<string, OwnedGroup>>;
}

export interface SourceOwnedGroupConflict {
  readonly key: string;
  readonly groupId: string;
  readonly existing: Record<string, unknown>;
  readonly incoming: Record<string, unknown>;
  readonly incomingCanonicalId: string;
  readonly incomingSourceType: string;
}

export interface SourceOwnedGroupMerge {
  readonly metadata: Record<string, unknown>;
  readonly groupedFields: ReadonlySet<string>;
  readonly ownedFieldGroups: ReadonlyMap<string, string>;
  readonly conflicts: readonly SourceOwnedGroupConflict[];
}

export interface SourceOwnedMetadataGroupOwner {
  readonly canonicalId: string;
  readonly fields: readonly string[];
}

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateIdentifier(value: unknown, description: string): string {
  if (typeof value !== 'string' || !SAFE_IDENTIFIER.test(value)) {
    throw new Error(`${description} must be a non-empty safe identifier`);
  }
  return value;
}

function validateFields(value: unknown, description: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${description} must declare at least one field`);
  }
  const fields = value.map((field, index) => {
    const key = validateIdentifier(field, `${description} field ${index + 1}`);
    if (RESERVED_FIELDS.has(key)) {
      throw new Error(`${description} cannot own reserved Resource metadata field ${key}`);
    }
    return key;
  });
  if (new Set(fields).size !== fields.length) {
    throw new Error(`${description} contains duplicate fields`);
  }
  return fields.sort();
}

/** Validate and canonicalize untrusted group declarations at source creation. */
export function validateResourceMetadataGroups(
  groups: readonly ResourceMetadataGroup[] | undefined,
): ResourceMetadataGroup[] | undefined {
  if (groups === undefined) return undefined;
  if (!Array.isArray(groups)) throw new Error('Resource metadata groups must be an array');

  const ids = new Set<string>();
  const fields = new Set<string>();
  return groups.map((group, index) => {
    if (!isRecord(group)) throw new Error(`Resource metadata group ${index + 1} must be an object`);
    const id = validateIdentifier(group['id'], `Resource metadata group ${index + 1} id`);
    if (ids.has(id)) throw new Error(`Resource metadata group id is duplicated: ${id}`);
    ids.add(id);

    const groupFields = validateFields(group['fields'], `Resource metadata group ${id}`);
    for (const field of groupFields) {
      if (fields.has(field)) throw new Error(`Resource metadata field belongs to multiple groups: ${field}`);
      fields.add(field);
    }
    return { id, fields: groupFields };
  });
}

function readOwnedGroups(metadata: Record<string, unknown>): Map<string, OwnedGroup> {
  const raw = metadata[SOURCE_OWNED_METADATA_GROUPS_KEY];
  if (raw === undefined) return new Map();
  if (!isRecord(raw) || raw['schemaVersion'] !== 1 || !isRecord(raw['groups'])) {
    throw new Error('stored source-owned Resource metadata groups are invalid');
  }

  const groups = new Map<string, OwnedGroup>();
  const fields = new Set<string>();
  for (const [rawId, rawOwner] of Object.entries(raw['groups'])) {
    const id = validateIdentifier(rawId, 'stored Resource metadata group id');
    if (!isRecord(rawOwner)) throw new Error(`stored Resource metadata group ${id} is invalid`);
    const canonicalId = rawOwner['canonicalId'];
    if (typeof canonicalId !== 'string' || canonicalId.trim().length === 0) {
      throw new Error(`stored Resource metadata group ${id} has no canonical owner`);
    }
    const groupFields = validateFields(rawOwner['fields'], `stored Resource metadata group ${id}`);
    for (const field of groupFields) {
      if (fields.has(field)) throw new Error(`stored Resource metadata field belongs to multiple groups: ${field}`);
      fields.add(field);
    }
    groups.set(id, { canonicalId, fields: groupFields });
  }
  return groups;
}

/** Read one persisted owner after validating the complete reserved ownership record. */
export function getSourceOwnedMetadataGroup(
  metadata: Record<string, unknown>,
  groupId: string,
): SourceOwnedMetadataGroupOwner | null {
  const id = validateIdentifier(groupId, 'Resource metadata group id');
  const owner = readOwnedGroups(metadata).get(id);
  return owner ? { canonicalId: owner.canonicalId, fields: [...owner.fields] } : null;
}

function groupValues(metadata: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const field of fields) {
    if (Object.hasOwn(metadata, field) && metadata[field] !== undefined) values[field] = metadata[field];
  }
  return values;
}

/**
 * Apply declared group patches before ordinary metadata merging. Omission is
 * retained for an existing owner; explicit null clears. Ownerless alias values
 * are never adopted because their origin cannot be proved from Resource-level
 * dedup keys or source-level provenance.
 */
export function mergeSourceOwnedMetadataGroups(
  existingMetadata: Record<string, unknown>,
  source: RawSource,
  sameCanonical: boolean,
): SourceOwnedGroupMerge {
  const owners = readOwnedGroups(existingMetadata);
  const declarations = validateResourceMetadataGroups(source.resourceMetadataGroups);
  const incoming = source.resourceMetadata ?? {};
  const groupedFields = new Set(declarations?.flatMap(group => group.fields) ?? []);
  const storedFieldGroups = new Map<string, string>();

  for (const [id, owner] of owners) {
    for (const field of owner.fields) storedFieldGroups.set(field, id);
  }

  for (const field of Object.keys(incoming)) {
    const storedGroupId = storedFieldGroups.get(field);
    if (storedGroupId !== undefined && !groupedFields.has(field)) {
      throw new Error(`Resource metadata field ${field} is owned by group ${storedGroupId}; declare that group to update it`);
    }
  }

  const merged = { ...existingMetadata };
  const conflicts: SourceOwnedGroupConflict[] = [];

  for (const declaration of declarations ?? []) {
    const stored = owners.get(declaration.id);
    if (stored && stored.fields.join('\0') !== declaration.fields.join('\0')) {
      throw new Error(`Resource metadata group ${declaration.id} cannot change its fields`);
    }
    for (const field of declaration.fields) {
      const otherGroup = storedFieldGroups.get(field);
      if (otherGroup !== undefined && otherGroup !== declaration.id) {
        throw new Error(`Resource metadata field ${field} is already owned by group ${otherGroup}`);
      }
    }

    const incomingValues = groupValues(incoming, declaration.fields);
    if (Object.keys(incomingValues).length === 0) continue;

    let mayUpdate = false;
    if (stored) {
      mayUpdate = stored.canonicalId === source.canonicalId;
    } else {
      const hasExistingValue = declaration.fields.some(
        field => Object.hasOwn(existingMetadata, field) && existingMetadata[field] !== undefined,
      );
      mayUpdate = sameCanonical || !hasExistingValue;
    }

    if (!mayUpdate) {
      conflicts.push({
        key: `metadata-group:${declaration.id}`,
        groupId: declaration.id,
        existing: groupValues(existingMetadata, declaration.fields),
        incoming: incomingValues,
        incomingCanonicalId: source.canonicalId,
        incomingSourceType: source.sourceType,
      });
      continue;
    }

    for (const field of declaration.fields) {
      if (Object.hasOwn(incoming, field) && incoming[field] !== undefined) {
        merged[field] = incoming[field];
      } else if (!Object.hasOwn(existingMetadata, field) || existingMetadata[field] === undefined) {
        // A newly initialized group has a complete representation. Existing
        // values are retained on exact-canonical adoption and owner patches.
        merged[field] = null;
      }
    }

    owners.set(declaration.id, {
      canonicalId: source.canonicalId,
      fields: declaration.fields,
    });
  }

  const ownedFieldGroups = new Map<string, string>();
  const persistedGroups: Record<string, OwnedGroup> = {};
  for (const [id, owner] of owners) {
    persistedGroups[id] = owner;
    for (const field of owner.fields) ownedFieldGroups.set(field, id);
  }

  if (owners.size > 0 || existingMetadata[SOURCE_OWNED_METADATA_GROUPS_KEY] !== undefined) {
    const ownerMetadata: OwnedGroupsMetadata = { schemaVersion: 1, groups: persistedGroups };
    merged[SOURCE_OWNED_METADATA_GROUPS_KEY] = ownerMetadata;
  }

  return { metadata: merged, groupedFields, ownedFieldGroups, conflicts };
}
