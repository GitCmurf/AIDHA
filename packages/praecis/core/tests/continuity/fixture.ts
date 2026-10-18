export const capture = {
  kind: 'capture', eventId: 'capture-1', expectedRevision: 0,
  source: { id: 'account-1', text: 'An example for Friday: River goes to robotics with Morgan. Sky goes to orchestra with me. Pack the instrument first. We settled on the tram for Friday only. I do not know the prep assignment yet.', author: 'user', capturedAt: '2026-10-02T09:00:00Z', intent: 'illustrative' },
  title: 'Friday activities', interpreter: 'synthetic-test-fixture',
  activities: [
    { id: 'robotics', label: 'Robotics', date: '2026-10-02', participants: ['River', 'Morgan'], prerequisites: [] },
    { id: 'pack', label: 'Pack instrument', date: '2026-10-02', participants: ['Parent'], prerequisites: [] },
    { id: 'orchestra', label: 'Orchestra', date: '2026-10-02', participants: ['Sky', 'Parent'], prerequisites: ['pack'] },
  ],
  facts: [
    { id: 'venue', activityId: 'orchestra', key: 'location', value: 'West Hall', basis: 'inferred', appliesOn: '2026-10-02' },
    { id: 'robotics-time', activityId: 'robotics', key: 'start', value: '16:30', basis: 'inferred', appliesOn: '2026-10-02' },
  ],
  decisions: [{ id: 'travel', choice: 'Use the tram', by: 'user', appliesOn: '2026-10-02', activityIds: ['orchestra'], conditions: [], revisitWhen: ['Tram unavailable'] }],
  questions: [{ id: 'prep', question: 'What is the prep assignment?', activityIds: ['orchestra'] }],
};
