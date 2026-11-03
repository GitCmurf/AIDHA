// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

// Exercise the dependency selected by the installed test toolchain, without adding
// PostCSS or source-map-js as direct application dependencies.
const workspaceRequire = createRequire(new URL('../../packages/praecis/core/package.json', import.meta.url));
const vitestRequire = createRequire(workspaceRequire.resolve('vitest/package.json'));
const viteRequire = createRequire(vitestRequire.resolve('vite/package.json'));
const postcssRequire = createRequire(viteRequire.resolve('postcss/package.json'));
const postcss = viteRequire('postcss');
const { SourceMapConsumer, SourceMapGenerator } = postcssRequire('source-map-js');

test('PostCSS preserves original source positions and text while transforming mapped CSS', async context => {
    context.diagnostic(`PostCSS ${viteRequire('postcss/package.json').version}; source-map-js ${postcssRequire('source-map-js/package.json').version}`);
    const originalSource = '\n'.repeat(6) + '  a { color: red; }\n';
    const previous = new SourceMapGenerator({ file: 'compiled.css' });
    previous.addMapping({
        generated: { line: 1, column: 0 },
        original: { line: 7, column: 2 },
        source: 'original.scss',
    });
    previous.setSourceContent('original.scss', originalSource);

    const result = await postcss([{
        postcssPlugin: 'benign-source-map-compatibility',
        Declaration(declaration) {
            if (declaration.prop === 'color') declaration.value = 'blue';
        },
    }]).process('a { color: red; }\n', {
        from: 'compiled.css',
        to: 'output.css',
        map: { prev: previous.toJSON(), inline: false, annotation: false },
    });

    assert.equal(result.css, 'a { color: blue; }\n');
    assert.ok(result.map, 'a transformed stylesheet retains its source map');
    const consumer = new SourceMapConsumer(result.map.toJSON());
    assert.deepEqual(consumer.originalPositionFor({ line: 1, column: 0 }), {
        source: 'original.scss', line: 7, column: 2, name: null,
    });
    assert.equal(consumer.sourceContentFor('original.scss'), originalSource);
});
