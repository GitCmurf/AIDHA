import { describe, it, expect } from 'vitest';
import { resolveConfig } from '../src/resolver.js';
import type { AidhaConfig } from '../src/types.js';

describe('resolveConfig — RSS Tiers', () => {
  const minimalConfig = (overrides: Partial<AidhaConfig> = {}): AidhaConfig => ({
    config_version: 1,
    default_profile: 'default',
    profiles: { default: { llm: { model: 'test' } } },
    ...overrides,
  });

  it('Tier 3: Source defaults apply when no profile override exists', () => {
    const config = minimalConfig({
      sources: {
        rss: { rss: { poll_interval_minutes: 120 } },
      },
    });
    expect(resolved.rss?.pollIntervalMinutes).toBe(120);
  });

  it('Tier 2: Named profile overrides source defaults', () => {
    const config = minimalConfig({
      profiles: {
        default: {},
        'custom-rss': { rss: { poll_interval_minutes: 15 } },
      },
      sources: {
        rss: { rss: { poll_interval_minutes: 120 } },
      },
    });
    const resolved = resolveConfig({
        rawConfig: config,
        profileName: 'custom-rss',
        sourceId: 'rss'
    });
    // Tier 2 (15) > Tier 3 (120)
    expect(resolved.rss?.pollIntervalMinutes).toBe(15);
  });

  it('Tier 4/5: Absence resolves to defaults (60 min)', () => {
    const config = minimalConfig();
    const resolved = resolveConfig({ rawConfig: config, sourceId: 'rss' });
    // Hardcoded default in resolver.ts is 60
    expect(resolved.rss?.pollIntervalMinutes).toBe(60);
  });
});
