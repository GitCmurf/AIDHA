// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { describe, expect, it } from 'vitest';
import { createRawSource, emptySourceConfigRegistration } from '../../src/compose/source-envelope.js';

const clock = { now: () => new Date('2026-05-25T12:34:56.000Z') };

describe('createRawSource', () => {
  it('stamps provenance from the runtime clock and strips reserved Resource metadata keys', () => {
    const raw = createRawSource({
      canonicalId: 'web:https://example.com/a',
      sourceType: 'web',
      sensitivity: 'public',
      sourceUri: 'https://example.com/a',
      clock,
      payload: { html: '<p>Hello</p>' },
      label: 'Example',
      resourceMetadata: {
        title: 'Example',
        canonicalId: 'attacker-value',
        provenances: ['attacker-value'],
        label: 'attacker-value',
      },
    });

    expect(raw.provenance).toEqual({
      sourceUri: 'https://example.com/a',
      ingestedAt: '2026-05-25T12:34:56.000Z',
      sourceType: 'web',
    });
    expect(raw.resourceMetadata).toEqual({ title: 'Example' });
  });

  it('fails before persistence when source metadata is not JSON-safe', () => {
    expect(() => createRawSource({
      canonicalId: 'voice:fixture',
      sourceType: 'voice',
      sensitivity: 'personal',
      clock,
      payload: {},
      label: 'Fixture',
      resourceMetadata: { bad: Number.NaN },
    })).toThrow('bad is not JSON-safe');

    expect(() => createRawSource({
      canonicalId: 'voice:fixture',
      sourceType: 'voice',
      sensitivity: 'personal',
      clock,
      payload: {},
      label: 'Fixture',
      resourceMetadata: { bad: new Date('2026-05-25T12:34:56.000Z') },
    })).toThrow('bad is not JSON-safe');
  });
});

describe('emptySourceConfigRegistration', () => {
  it('rejects unknown source-private config instead of silently accepting typos', () => {
    const registration = emptySourceConfigRegistration('web');

    expect(registration.validateActiveSourceConfig(undefined)).toEqual({});
    expect(registration.validateActiveSourceConfig({})).toEqual({});
    expect(() => registration.validateActiveSourceConfig({ typo: true })).toThrow(
      'web source config does not accept source-private keys',
    );
  });
});
