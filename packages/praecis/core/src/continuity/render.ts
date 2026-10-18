// SPDX-License-Identifier: Apache-2.0
import type { showCase } from './index.js';

function inline(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')
    .replace(/[\\`*_{}[\]()#!|]/gu, '\\$&');
}

export function renderContinuityMarkdown(view: Awaited<ReturnType<typeof showCase>>): string {
  const lines = [
    `# ${inline(view.title)}`, '',
    `${view.on} · ${view.intent} · revision ${view.revision}`, '',
    '## Activities', '',
  ];
  for (const activity of view.activities) {
    const date = activity.date === null ? 'date unknown'
      : `${activity.date}${activity.dateBasis ? ` (date ${activity.dateBasis})` : ''}`;
    lines.push(`- ${inline(activity.label)} (${date}): ${activity.participants.map(inline).join(', ')};`
      + ` prerequisites: ${activity.prerequisites.map(inline).join(', ') || 'none recorded'}`);
  }
  lines.push('', '## Latest recorded facts', '');
  for (const fact of view.facts) {
    lines.push(`- ${inline(fact.activityId)} / ${inline(fact.key)}: ${inline(fact.value ?? 'unknown')}`
      + ` (${fact.basis}; applies ${fact.appliesOn ?? 'date unknown'}; source ${inline(fact.sourceId)})`);
  }
  lines.push('', '## Decisions for this date', '');
  for (const decision of view.decisions.current) {
    lines.push(`- ${inline(decision.choice)}; conditions: ${decision.conditions.map(inline).join('; ') || 'none recorded'}`);
  }
  if (view.decisions.historical.length) {
    lines.push('', '## Historical decisions', '');
    for (const decision of view.decisions.historical) {
      lines.push(`- ${decision.appliesOn}: ${inline(decision.choice)}`);
    }
  }
  lines.push('', '## Source history', '');
  for (const source of view.sources) {
    lines.push(`- ${inline(source.id)} · ${inline(source.author)} · ${source.capturedAt}`);
  }
  lines.push('', '## Unresolved', '', ...view.questions.map(item => `- ${inline(item.question)}`), '',
    'Exact source text and full event history: use `continuity show --json`.', '');
  return lines.join('\n');
}
