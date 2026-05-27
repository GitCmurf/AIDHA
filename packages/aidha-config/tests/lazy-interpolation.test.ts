// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Colin Farmer (GitCmurf)

import { describe, it, expect, vi } from 'vitest';
import { resolveConfig } from '../src/resolver.js';
import { AidhaConfig } from '../src/types.js';

describe('Lazy Interpolation and Type Coercion', () => {
  const rawConfig: AidhaConfig = {
    config_version: 1,
    default_profile: 'local',
    profiles: {
      local: {
        llm: {
          timeout_ms: '${LLM_TIMEOUT:-30000}' as any,
          model: 'gpt-local',
        }
      },
      unused: {
        llm: {
          api_key: '${MISSING_VAR}',
          timeout_ms: '${INVALID_NUM:-not-a-number}' as any,
        }
      }
    }
  };

  it('should only interpolate the active profile', () => {
    // MISSING_VAR is NOT set in environment.
    // resolving 'local' should succeed because 'unused' is ignored.
    const resolved = resolveConfig({
      rawConfig,
      profileName: 'local',
    });

    expect(resolved.llm.model).toBe('gpt-local');
    expect(resolved.llm.timeoutMs).toBe(30000); // Coerced to number
    expect(typeof resolved.llm.timeoutMs).toBe('number');
  });

  it('should fail if the active profile has missing variables', () => {
    expect(() => resolveConfig({
      rawConfig,
      profileName: 'unused',
    })).toThrow(/Environment variable "MISSING_VAR" is not set/);
  });

  it('should coerce interpolated variables to correct types', () => {
    try {
      vi.stubEnv('LLM_TIMEOUT', '60000');

      const resolved = resolveConfig({
        rawConfig,
        profileName: 'local',
      });

      expect(resolved.llm.timeoutMs).toBe(60000);
      expect(typeof resolved.llm.timeoutMs).toBe('number');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('should handle boolean coercion from environment variables', () => {
    const configWithBool: AidhaConfig = {
      config_version: 1,
      default_profile: 'local',
      profiles: {
        local: {
          editor: {
            editor_llm: '${USE_LLM:-false}' as any
          }
        }
      }
    };

    try {
      vi.stubEnv('USE_LLM', 'true');
      const resolved = resolveConfig({ rawConfig: configWithBool, profileName: 'local' });
      expect(resolved.editor.editorLlm).toBe(true);
      expect(typeof resolved.editor.editorLlm).toBe('boolean');

      vi.stubEnv('USE_LLM', '0');
      const resolved2 = resolveConfig({ rawConfig: configWithBool, profileName: 'local' });
      expect(resolved2.editor.editorLlm).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('should not interpolate inactive source_overrides while resolving core fields', () => {
    const configWithSourceOverrides: AidhaConfig = {
      config_version: 1,
      default_profile: 'local',
      profiles: {
        local: {
          llm: {
            model: 'gpt-local',
          },
          source_overrides: {
            youtube: {
              youtube: {
                cookie: '${YOUTUBE_COOKIE}' as any,
              },
            },
          },
        },
      },
    };

    const resolved = resolveConfig({
      rawConfig: configWithSourceOverrides,
      profileName: 'local',
    });

    expect(resolved.llm.model).toBe('gpt-local');
    expect(resolved.activeSourceConfig).toBeUndefined();
  });
});
