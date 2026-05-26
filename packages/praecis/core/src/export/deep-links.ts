// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import type { Locator } from '../types/locator.js';

function formatMmSs(totalSec: number): string {
  const total = Math.max(0, Math.floor(totalSec));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function extractYouTubeId(resourceUri: string): string | null {
  try {
    const url = new URL(resourceUri);
    if (url.hostname === 'youtu.be') {
      // pathname is /<id>
      const id = url.pathname.slice(1);
      return id.length > 0 ? id : null;
    }
    if (url.hostname === 'www.youtube.com' || url.hostname === 'youtube.com') {
      const v = url.searchParams.get('v');
      return v;
    }
  } catch {
    // unparsable
  }
  return null;
}

function isYouTube(resourceUri: string): boolean {
  try {
    const url = new URL(resourceUri);
    return url.hostname === 'youtu.be' || url.hostname === 'youtube.com' || url.hostname === 'www.youtube.com';
  } catch {
    return false;
  }
}

export function renderDeepLink(resourceUri: string, locator: Locator): string | null {
  switch (locator.kind) {
    case 'timecode': {
      if (isYouTube(resourceUri)) {
        const id = extractYouTubeId(resourceUri);
        if (id !== null) {
          return `https://youtu.be/${id}?t=${locator.startSec}`;
        }
      }
      return `${resourceUri}#t=${locator.startSec}`;
    }
    case 'page':
      return `${resourceUri}#page=${locator.page}`;
    case 'dom':
      return `${resourceUri}#:~:text=${encodeURIComponent(locator.textFragment)}`;
    case 'message':
      return `${resourceUri}#${locator.messageId}`;
    case 'text':
      return resourceUri.length > 0 ? resourceUri : null;
    case 'external':
      return null;
  }
}

export function renderLabel(locator: Locator): string {
  switch (locator.kind) {
    case 'timecode':
      return formatMmSs(locator.startSec);
    case 'page':
      return `p.${locator.page}`;
    case 'dom':
      return locator.textFragment.slice(0, 40);
    case 'message':
      return locator.messageId;
    case 'text':
      return '';
    case 'external':
      return `${locator.system}: ${locator.externalId}`;
  }
}
