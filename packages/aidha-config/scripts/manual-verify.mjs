
import { mutateConfig } from '../dist/writer.js';
import { writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpFile = join(tmpdir(), `aidha-config-manual-verify-${Date.now()}.yaml`);

const cleanup = () => {
    try { unlinkSync(tmpFile); } catch {}
};

console.log('--- Starting Manual Verification ---');

let passed = true;

// 1. Alias Copy-on-Write
try {
    console.log('\n[1/4] Verifying Alias Copy-on-Write...');
    const yaml = `
config_version: 1
default_profile: default
profiles:
  base:
    llm: &llm_base
      model: gpt-4o
  default:
    llm: *llm_base
`;
    writeFileSync(tmpFile, yaml, 'utf-8');

    const result = mutateConfig({
        filePath: tmpFile,
        keyPath: 'profiles.default.llm.model',
        value: 'gpt-4-turbo'
    });

    if (!result.written) throw new Error('Result.written is false');

    const content = readFileSync(tmpFile, 'utf-8');

    // Check target updated
    if (!content.includes('model: gpt-4-turbo')) {
        throw new Error('Target value not updated');
    }
    // Check anchor preserved
    if (!content.includes('model: gpt-4o')) {
        throw new Error('Anchor source overwritten (Copy-on-Write failed)');
    }
    console.log('PASS: Alias CoW logic works.');
} catch (e) {
    console.error('FAIL: Alias check failed:', e.message);
    passed = false;
} finally {
    cleanup();
}

// 2. Validation (Integer & Boolean)
try {
    console.log('\n[2/4] Verifying Validation Errors...');
    const yaml = `
config_version: 1
default_profile: default
profiles:
  default:
    ytdlp:
      keep_files: true
`;
    writeFileSync(tmpFile, yaml, 'utf-8');

    // Integer check
    try {
        mutateConfig({
            filePath: tmpFile,
            keyPath: 'config_version',
            value: '1.5'
        });
        console.error('FAIL: Float input for integer did NOT throw');
        passed = false;
    } catch (e) {
        if (e.message.includes('Expected an integer')) {
            console.log('PASS: Integer validation correctly rejected float.');
        } else {
             console.error('FAIL: Unexpected error for float:', e.message);
             passed = false;
        }
    }

    // Boolean check
    try {
        mutateConfig({
            filePath: tmpFile,
            keyPath: 'profiles.default.ytdlp.keep_files',
            value: 'maybe'
        });
        console.error('FAIL: Invalid boolean did NOT throw');
        passed = false;
    } catch (e) {
        if (e.message.includes('Expected one of: true, false, 1, 0')) {
            console.log('PASS: Boolean validation checks allowed values.');
        } else {
            console.error('FAIL: Unexpected error for boolean:', e.message);
            passed = false;
        }
    }

} catch (e) {
    console.error('FAIL: Validation check failed:', e.message);
    passed = false;
} finally {
    cleanup();
}

// 3. Empty File / Null Root Regression
try {
    console.log('\n[3/4] Verifying Empty File Handling...');
    // Create empty file
    writeFileSync(tmpFile, '', 'utf-8');

    // Mutate it (should initialize doc.contents and succeed)
    const result = mutateConfig({
        filePath: tmpFile,
        keyPath: 'new_section.key',
        value: 'value',
        skipValidation: true
    });

    if (!result.written) throw new Error('Result.written is false for empty file');

    const content = readFileSync(tmpFile, 'utf-8');
    if (!content.includes('key: value')) {
        throw new Error('Empty file was not populated correctly');
    }
    console.log('PASS: Empty file successfully initialized and mutated.');

     // 4. Root Key on Empty File Regression
    console.log('\n[4/4] Verifying Root Key on Empty File...');
    // Clear file again
    writeFileSync(tmpFile, '', 'utf-8');

    const resultRoot = mutateConfig({
        filePath: tmpFile,
        keyPath: 'default_profile',
        value: 'local',
        skipValidation: true
    });

    if (!resultRoot.written) throw new Error('Result.written is false for root key');

    const contentRoot = readFileSync(tmpFile, 'utf-8');
    if (!contentRoot.includes('default_profile: local')) {
        throw new Error('Root key was not written to empty file');
    }
    console.log('PASS: Root key successfully written to empty file.');

} catch(e) {
    console.error('FAIL: Empty file check failed:', e.message);
    passed = false;
} finally {
    cleanup();
}

if (!passed) {
    console.error('\nOVERALL: FAILED');
    process.exit(1);
} else {
    console.log('\nOVERALL: PASSED');
}
