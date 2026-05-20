import { describe, it, expect } from 'vitest';
import type { SourceRegistration, ResolvedConfig } from '../src/types.js';
import { resolveConfig } from '../src/resolver.js';

interface MockSourceConfig {
  widget: { name: string; timeout_ms: number };
  auth: { token: string };
}

const MOCK_SOURCE_REGISTRATION: SourceRegistration<MockSourceConfig> = {
  sourceId: 'mock-source',
  defaults: {
    widget: { name: 'default-widget', timeout_ms: 5000 },
    auth: { token: '' },
  },
  metadata: {
    pathFields: [],
    secretFields: ['auth.token'],
    scalarCoercions: {},
    explainLabels: { 'widget.name': 'Widget name' },
  },
  validateActiveSourceConfig(value: unknown): MockSourceConfig {
    if (value === null || typeof value !== 'object') {
      throw new Error('activeSourceConfig must be an object');
    }
    const obj = value as Record<string, unknown>;
    const widget = obj.widget as Record<string, unknown> | undefined;
    const auth = obj.auth as Record<string, unknown> | undefined;
    return {
      widget: {
        name: (widget?.name as string) ?? '',
        timeout_ms: (widget?.timeout_ms as number) ?? 0,
      },
      auth: {
        token: (auth?.token as string) ?? '',
      },
    };
  },
  redactActiveSourceConfig(value: MockSourceConfig): unknown {
    return {
      ...value,
      auth: { token: '********' },
    };
  },
};

describe('SourceRegistration contract', () => {
  it('should allow a mock source registration to compile and be called', () => {
    expect(MOCK_SOURCE_REGISTRATION.sourceId).toBe('mock-source');
    expect(MOCK_SOURCE_REGISTRATION.defaults).toBeDefined();
    expect(MOCK_SOURCE_REGISTRATION.metadata?.secretFields).toContain('auth.token');
  });

  it('should validate and narrow activeSourceConfig locally', () => {
    const raw = {
      widget: { name: 'test-widget', timeout_ms: 10000 },
      auth: { token: 'secret-value' },
    };
    const validated = MOCK_SOURCE_REGISTRATION.validateActiveSourceConfig(raw);
    expect(validated.widget.name).toBe('test-widget');
    expect(validated.auth.token).toBe('secret-value');
  });

  it('should throw on invalid input', () => {
    expect(() => MOCK_SOURCE_REGISTRATION.validateActiveSourceConfig(null)).toThrow();
    expect(() => MOCK_SOURCE_REGISTRATION.validateActiveSourceConfig('string')).toThrow();
  });

  it('should redact source-owned secrets', () => {
    const config: MockSourceConfig = {
      widget: { name: 'w', timeout_ms: 1 },
      auth: { token: 'super-secret' },
    };
    const redacted = MOCK_SOURCE_REGISTRATION.redactActiveSourceConfig?.(config);
    expect((redacted as Record<string, unknown>).auth).toEqual({ token: '********' });
  });
});

describe('ResolvedConfig has source boundary fields', () => {
  it('should include activeSourceId when a source is selected', () => {
    const resolved = resolveConfig({ sourceId: 'youtube' });
    expect(resolved.activeSourceId).toBe('youtube');
  });

  it('should leave activeSourceId undefined when no source is selected', () => {
    const resolved = resolveConfig();
    expect(resolved.activeSourceId).toBeUndefined();
  });

  it('should include activeSourceConfig when a source is selected', () => {
    const resolved = resolveConfig({ sourceId: 'youtube' });
    expect(resolved.activeSourceConfig).toBeDefined();
  });

  it('should leave activeSourceConfig undefined when no source is selected', () => {
    const resolved = resolveConfig();
    expect(resolved.activeSourceConfig).toBeUndefined();
  });
});

describe('ResolvedConfig does not have source-private fields', () => {
  it('should not have ytdlp on ResolvedConfig', () => {
    const resolved = resolveConfig({ sourceId: 'youtube' });
    expect('ytdlp' in resolved).toBe(false);
  });

  it('should not have youtube on ResolvedConfig', () => {
    const resolved = resolveConfig({ sourceId: 'youtube' });
    expect('youtube' in resolved).toBe(false);
  });

  it('should not have rss on ResolvedConfig', () => {
    const resolved = resolveConfig({ sourceId: 'rss' });
    expect('rss' in resolved).toBe(false);
  });
});

describe('Source registration drives resolver', () => {
  it('should place source registration defaults into activeSourceConfig', () => {
    const resolved = resolveConfig({
      sourceId: 'mock-source',
      sourceRegistrations: [MOCK_SOURCE_REGISTRATION],
    });
    expect(resolved.activeSourceId).toBe('mock-source');
    const sourceConfig = resolved.activeSourceConfig as Record<string, unknown>;
    const widget = sourceConfig.widget as Record<string, unknown>;
    expect(widget.name).toBe('default-widget');
  });

  it('should merge user source defaults over registration defaults', () => {
    const resolved = resolveConfig({
      sourceId: 'mock-source',
      rawConfig: {
        config_version: 1,
        default_profile: 'default',
        profiles: { default: {} },
        sources: {
          'mock-source': {
            widget: { name: 'user-widget' },
          },
        },
      },
      sourceRegistrations: [MOCK_SOURCE_REGISTRATION],
    });
    const sourceConfig = resolved.activeSourceConfig as Record<string, unknown>;
    const widget = sourceConfig.widget as Record<string, unknown>;
    expect(widget.name).toBe('user-widget');
    expect(widget.timeout_ms).toBe(5000);
  });

  it('should merge profile source_overrides into activeSourceConfig', () => {
    const resolved = resolveConfig({
      sourceId: 'mock-source',
      profileName: 'production',
      rawConfig: {
        config_version: 1,
        default_profile: 'default',
        profiles: {
          default: {},
          production: {
            source_overrides: {
              'mock-source': {
                widget: { timeout_ms: 99999 },
              },
            },
          },
        },
      },
      sourceRegistrations: [MOCK_SOURCE_REGISTRATION],
    });
    const sourceConfig = resolved.activeSourceConfig as Record<string, unknown>;
    const widget = sourceConfig.widget as Record<string, unknown>;
    expect(widget.timeout_ms).toBe(99999);
  });

  it('should support validateActiveSourceConfig for narrowing after resolution', () => {
    const resolved = resolveConfig({
      sourceId: 'mock-source',
      sourceRegistrations: [MOCK_SOURCE_REGISTRATION],
    });
    const validated = MOCK_SOURCE_REGISTRATION.validateActiveSourceConfig(
      resolved.activeSourceConfig,
    );
    expect(validated.widget.name).toBe('default-widget');
    expect(validated.auth.token).toBe('');
  });
});

describe('SourceRegistration metadata contract', () => {
  it('should have metadata.pathFields as an array of dot-notation paths', () => {
    const meta = MOCK_SOURCE_REGISTRATION.metadata;
    expect(Array.isArray(meta?.pathFields)).toBe(true);
    for (const field of meta?.pathFields ?? []) {
      expect(typeof field).toBe('string');
      expect(field.length).toBeGreaterThan(0);
    }
  });

  it('should have metadata.secretFields as an array of dot-notation paths', () => {
    const meta = MOCK_SOURCE_REGISTRATION.metadata;
    expect(Array.isArray(meta?.secretFields)).toBe(true);
    expect(meta?.secretFields).toContain('auth.token');
  });

  it('should have metadata.scalarCoercions mapping to number|boolean|string', () => {
    const meta = MOCK_SOURCE_REGISTRATION.metadata;
    expect(meta?.scalarCoercions).toBeDefined();
    const validTypes = new Set(['number', 'boolean', 'string']);
    for (const [, coercionType] of Object.entries(meta?.scalarCoercions ?? {})) {
      expect(validTypes.has(coercionType)).toBe(true);
    }
  });

  it('should have metadata.explainLabels mapping paths to human strings', () => {
    const meta = MOCK_SOURCE_REGISTRATION.metadata;
    expect(meta?.explainLabels).toBeDefined();
    for (const [, label] of Object.entries(meta?.explainLabels ?? {})) {
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
    }
  });
});
