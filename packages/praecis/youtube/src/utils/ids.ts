import { createHash } from 'node:crypto';

export function hashId(prefix: string, parts: Array<string | number | undefined>): string {
  const input = [prefix, ...parts.map(part => (part === undefined ? '' : String(part)))].join('|');
  const digest = createHash('sha256').update(input).digest('hex').slice(0, 16);
  return `${prefix}-${digest}`;
}
