import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('frontend asset sync copies sources and prunes outputs of renamed and deleted files', async () => {
  const { syncFrontendAssets } = await import(new URL('../scripts/web-assets.mjs', import.meta.url).href);
  const directory = await mkdtemp(join(tmpdir(), 'language-assets-'));
  const source = join(directory, 'src'), output = join(directory, 'dist');
  const catalog = { languages: [{ id: 'A', label: 'A' }], comparisonCount: 10 };
  const sync = () => syncFrontendAssets({ sourceDirectory: source, outputDirectory: output, catalog });
  try {
    await mkdir(source); await mkdir(join(output, 'vendor'), { recursive: true });
    await writeFile(join(source, 'app.ts'), 'export const value = 1;');
    await writeFile(join(source, 'browser.d.ts'), 'interface Window {}');
    await writeFile(join(source, 'style.css'), 'body { color: red; }');
    await writeFile(join(source, 'index.html'), '<html><!-- LANGUAGE_CATALOG --></html>');
    for (const extension of ['js', 'js.map', 'd.ts']) await writeFile(join(output, `app.${extension}`), 'generated');
    await writeFile(join(output, 'vendor/library.js'), 'vendor');
    await sync();
    assert.equal(await readFile(join(output, 'style.css'), 'utf8'), 'body { color: red; }');
    assert.match(await readFile(join(output, 'index.html'), 'utf8'), /"comparisonCount":10/);
    await assert.rejects(access(join(output, 'browser.d.ts')));
    await rename(join(source, 'app.ts'), join(source, 'renamed.ts'));
    await rm(join(source, 'style.css'));
    await writeFile(join(output, 'renamed.js'), 'new compiled output');
    await sync();
    for (const name of ['app.js', 'app.js.map', 'app.d.ts', 'style.css']) await assert.rejects(access(join(output, name)));
    assert.equal(await readFile(join(output, 'renamed.js'), 'utf8'), 'new compiled output');
    // Catch an emission that arrived after the deletion had already been recorded.
    await writeFile(join(output, 'app.js'), 'late stale emission');
    await sync(); await assert.rejects(access(join(output, 'app.js')));
    assert.equal(await readFile(join(output, 'vendor/library.js'), 'utf8'), 'vendor');
    assert.equal(await readFile(join(source, 'browser.d.ts'), 'utf8'), 'interface Window {}');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('asset watcher rebuilds HTML on template edits and catalog changes', async () => {
  const { watchFrontendAssets } = await import(new URL('../scripts/web-asset-watch.mjs', import.meta.url).href);
  const directory = await mkdtemp(join(tmpdir(), 'language-watch-'));
  const source = join(directory, 'src'), output = join(directory, 'dist'), data = join(directory, 'data');
  let watcher;
  let complete: (() => void) | undefined, fail: ((error: Error) => void) | undefined;
  const change = async (write: () => Promise<void>) => {
    const rebuilt = new Promise<void>((resolve, reject) => { complete = resolve; fail = reject; });
    const timeout = setTimeout(() => fail?.(new Error('Timed out waiting for HTML rebuild')), 5000);
    try { await write(); await rebuilt; }
    finally { clearTimeout(timeout); complete = undefined; fail = undefined; }
    return readFile(join(output, 'index.html'), 'utf8');
  };
  try {
    await mkdir(source); await mkdir(join(data, 'graph'), { recursive: true });
    const catalog = { languages: [{ id: 'A', label: 'A' }], comparisonCount: 10 };
    await writeFile(join(data, 'graph/index.json'), JSON.stringify(catalog));
    const template = '<html><!-- LANGUAGE_CATALOG --><h1>Before</h1><!-- LANGUAGE_COUNT -->|<!-- COMPARISON_COUNT --></html>';
    await writeFile(join(source, 'index.html'), template);
    watcher = watchFrontendAssets({ sourceDirectory: source, outputDirectory: output, dataDirectory: data,
      onSynced: () => complete?.(), onError: (error: Error) => fail?.(error) });
    const edited = await change(() => writeFile(join(source, 'index.html'), template.replace('Before', 'After')));
    assert.match(edited, /<h1>After<\/h1>1\|10/);
    // Import checkpoints atomically replace their files.
    const updated = await change(async () => {
      await writeFile(join(data, 'graph/index.json.tmp'), JSON.stringify({ ...catalog, comparisonCount: 1234 }));
      await rename(join(data, 'graph/index.json.tmp'), join(data, 'graph/index.json'));
    });
    assert.match(updated, /1\|1,234/);
    const classified = await change(() => writeFile(join(data, 'languages-enriched.json'), JSON.stringify({
      languages: [{ id: 'A', label: 'A', classification: { status: 'isolate' } }],
    })));
    assert.match(classified, /"status":"isolate"/);
  } finally { await watcher?.close(); await rm(directory, { recursive: true, force: true }); }
});
