export function getHostnameFromUrl(value?: string): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isOpenAiBaseUrl(baseUrl?: string): boolean {
  const hostname = getHostnameFromUrl(baseUrl);
  return hostname === "openai.com" || (hostname !== null && hostname.endsWith(".openai.com"));
}

const URL_REGEX = /https?:\/\/[^\s>\]]+/g;

function normalizeUrl(url: string): string {
  let trimmed = url.replace(/[.,!?]+$/, '');
  let openCount = (trimmed.match(/\(/g) ?? []).length;
  let closeCount = (trimmed.match(/\)/g) ?? []).length;
  while (closeCount > openCount && trimmed.endsWith(')')) {
    trimmed = trimmed.slice(0, -1);
    closeCount -= 1;
  }
  return trimmed;
}

export function extractUrls(text: string | undefined): string[] {
  if (!text) return [];
  const matches = text.match(URL_REGEX) ?? [];
  const normalized = matches.map(match => normalizeUrl(match));
  return Array.from(new Set(normalized));
}
