import { describe, it, expect, afterEach } from 'vitest';
import { mutateConfig } from '../src/writer.js';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { SourceRegistration } from '../src/types.js';

describe('Writer Validation Errors', () => {
    const tmpFile = join(tmpdir(), `aidha-config-validation-${Date.now()}.yaml`);
    const youtubeRegistration: SourceRegistration = {
      sourceId: 'youtube',
      metadata: {
        scalarCoercions: {
          'ytdlp.timeout_ms': 'number',
        },
      },
      validateActiveSourceConfig(value: unknown) {
        if (!value || typeof value !== 'object') {
          throw new Error('activeSourceConfig must be an object');
        }
        const sourceConfig = value as { ytdlp?: { timeout_ms?: number } };
        if ((sourceConfig.ytdlp?.timeout_ms ?? 0) < 0) {
          throw new Error('ytdlp.timeout_ms must be greater than or equal to 0');
        }
        return value;
      },
    };

    const setupConfig = () => {
        const yaml = `
config_version: 1
default_profile: default
profiles:
  default:
    editor:
      editor_llm: true
`;
        writeFileSync(tmpFile, yaml, 'utf-8');
    };

    afterEach(() => {
        try { unlinkSync(tmpFile); } catch {}
    });

    it('should throw validation error for invalid numeric input', () => {
        setupConfig();
        try {
             mutateConfig({
                filePath: tmpFile,
                keyPath: 'config_version',
                value: 'not-a-number'
             });
             throw new Error('Should have thrown');
        } catch (e: any) {
             expect(e.message).toContain('Invalid numeric value for config_version: "not-a-number"');
        }
    });

    it('should throw validation error for invalid boolean input', () => {
        setupConfig();
        try {
             mutateConfig({
                filePath: tmpFile,
                keyPath: 'profiles.default.editor.editor_llm',
                value: 'maybe'
             });
             throw new Error('Should have thrown');
        } catch (e: any) {
             expect(e.message).toContain('Expected one of: true, false, 1, 0, yes, no, on, off');
        }
    });

    it('should return validation errors in dry-run mode for invalid inputs', () => {
        setupConfig();
        const result = mutateConfig({
            filePath: tmpFile,
            keyPath: 'config_version',
            value: 'NaN',
            dryRun: true
        });

        expect(result.written).toBe(false);
        expect(result.validationErrors.length).toBeGreaterThan(0);
        expect(result.validationErrors[0].message).toContain('Invalid numeric value');
    });

    it('should reject invalid source overrides using source registrations', () => {
        setupConfig();
        expect(() => mutateConfig({
            filePath: tmpFile,
            keyPath: 'profiles.default.source_overrides.youtube.ytdlp.timeout_ms',
            value: '-1',
            sourceRegistrations: [youtubeRegistration],
        })).toThrow(/validation failed/i);
    });
});
