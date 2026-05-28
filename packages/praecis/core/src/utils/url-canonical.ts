// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

const TRACKING_EXACT = new Set(['fbclid', 'gclid', 'ref']);

function isTrackingParam(key: string): boolean {
  return key.startsWith('utm_') || TRACKING_EXACT.has(key);
}

export function urlCanonical(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return rawUrl;
  }

  // Drop fragment; URL constructor lowercases scheme+host and drops default ports 80/443
  parsed.hash = '';

  // Remove tracking params
  const keysToDelete: string[] = [];
  for (const key of parsed.searchParams.keys()) {
    if (isTrackingParam(key)) keysToDelete.push(key);
  }
  for (const key of keysToDelete) {
    parsed.searchParams.delete(key);
  }

  // Sort remaining params
  parsed.searchParams.sort();

  // Normalise trailing slash: root keeps '/', non-root paths drop trailing slash
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }

  return parsed.toString();
}
