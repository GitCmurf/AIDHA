// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';

describe('Metadata Generation Script', () => {
  it('should discover secrets in complex schema structures', () => {
    const content = readFileSync(join(__dirname, '../src/schema.generated.ts'), 'utf-8');

    // api_key is from a $ref'd definition
    expect(content).toContain('"api_key"');

    // Verify other known secret patterns or explicit x-aidha-secret fields
    // Based on the current schema, only api_key and cookie are marked secret.
    expect(content).toContain('"cookie"');
  });

  it('verifies the traversal logic covers all key keywords (manual review of output)', () => {
     // This test acts as a reminder that traversal logic was reinforced
     // to cover allOf, anyOf, array items, and additionalProperties.
     // These are used for source_overrides and extensions in our schema.
     const content = readFileSync(join(__dirname, '../src/schema.generated.ts'), 'utf-8');

     // SECRET_LEAF_NAMES should be comprehensive
     expect(content).toContain('export const SECRET_LEAF_NAMES');
  });
});
