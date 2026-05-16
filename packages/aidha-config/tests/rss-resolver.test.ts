import { describe, it, expect } from 'vitest';
import { resolveConfig } from '../src/resolver.js';
import type { AidhaConfig, SourceRegistration } from '../src/types.js';

const RSS_REGISTRATION: SourceRegistration<{ rss: { poll_interval_minutes: number } }> = {
  sourceId: 'rss',
  defaults: {
    rss: { poll_interval_minutes: 60 },
  },
  validateActiveSourceConfig(value: unknown) {
    const obj = value as Record<string, unknown>;
    const rss = obj.rss as Record<string, unknown>;
    return {
      rss: {
        poll_interval_minutes: (rss?.poll_interval_minutes as number) ?? 60,
      },
    };
  },
};

describe('resolveConfig — RSS Tiers', () => {
  const minimalConfig = (overrides: Partial<AidhaConfig> = {}): AidhaConfig => ({
    config_version: 1,
    default_profile: 'default',
    profiles: { default: {} },
    ...overrides,
  });

  it('Tier 3: Source defaults apply when no profile override exists', () => {
    const config = minimalConfig({
      sources: {
        rss: { rss: { poll_interval_minutes: 120 } },
      },
    });
    const resolved = resolveConfig({
      rawConfig: config,
      sourceId: 'rss',
      sourceRegistrations: [RSS_REGISTRATION],
    });
    const sourceConfig = resolved.activeSourceConfig as Record<string, unknown>;
    const rss = sourceConfig.rss as Record<string, unknown>;
    expect(rss.poll_interval_minutes).toBe(120);
  });

  it('Tier 2: Named profile source_overrides override source defaults', () => {
    const config = minimalConfig({
      profiles: {
        default: {},
        'custom-rss': {
          source_overrides: {
            rss: { rss: { poll_interval_minutes: 15 } },
          },
        },
      },
      sources: {
        rss: { rss: { poll_interval_minutes: 120 } },
      },
    });
    const resolved = resolveConfig({
      rawConfig: config,
      profileName: 'custom-rss',
      sourceId: 'rss',
      sourceRegistrations: [RSS_REGISTRATION],
    });
    const sourceConfig = resolved.activeSourceConfig as Record<string, unknown>;
    const rss = sourceConfig.rss as Record<string, unknown>;
    expect(rss.poll_interval_minutes).toBe(15);
  });

  it('Tier 5: Registration defaults apply when no user config', () => {
    const resolved = resolveConfig({
      sourceId: 'rss',
      sourceRegistrations: [RSS_REGISTRATION],
    });
    const sourceConfig = resolved.activeSourceConfig as Record<string, unknown>;
    const rss = sourceConfig.rss as Record<string, unknown>;
    expect(rss.poll_interval_minutes).toBe(60);
  });
});
