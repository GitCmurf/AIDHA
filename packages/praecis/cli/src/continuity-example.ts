// SPDX-License-Identifier: Apache-2.0
import type { CaptureEvent, ContinuityEvent } from '@aidha/praecis-core';

// These fixed fictional inputs are a pair for a new case, not successive update templates.
const capture = {
  kind: 'capture', eventId: 'example-capture', expectedRevision: 0,
  source: {
    id: 'example-account', text: 'Fictional example: the meeting on 2 October is at West Hall.',
    author: 'Fictional author', capturedAt: '2026-10-01T09:00:00Z', intent: 'illustrative',
  },
  title: 'Illustrative meeting', interpreter: 'Fictional example author',
  activities: [{
    id: 'meeting', label: 'Fictional meeting', date: '2026-10-02', dateBasis: 'supplied',
    participants: ['Fictional participant'], prerequisites: [],
  }],
  facts: [{
    id: 'venue', activityId: 'meeting', key: 'location', value: 'West Hall',
    basis: 'supplied', appliesOn: '2026-10-02',
  }],
  decisions: [], questions: [],
} satisfies CaptureEvent;

const correction = {
  kind: 'correct', eventId: 'example-correction', expectedRevision: 1,
  source: {
    id: 'example-correction-account', text: 'Fictional correction: the meeting venue is East Hall.',
    author: 'Fictional author', capturedAt: '2026-10-01T10:00:00Z', intent: 'illustrative',
  },
  interpreter: 'Fictional example author', factId: 'venue', value: 'East Hall', basis: 'supplied',
} satisfies ContinuityEvent;

export const continuityExample = (kind: 'capture' | 'update') =>
  kind === 'capture' ? capture : correction;
