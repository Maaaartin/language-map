import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, readdir, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { comparisonUrl, parseComparison, parseLanguages, removeRawHtml } from '../scripts/lib.js';

const languagesHtml = await readFile(new URL('./fixtures/languages.html', import.meta.url), 'utf8');
const comparisonHtml = await readFile(new URL('./fixtures/altai-uzbek.html', import.meta.url), 'utf8');
const url = comparisonUrl('Altai', 'Uzbek');

test('extracts matching dropdown IDs and readable labels', () => {
  const languages = parseLanguages(languagesHtml);
  assert.ok(languages.length > 500);
  assert.deepEqual(languages.find(l => l.id === 'Albanian_(Gheg)'), { id: 'Albanian_(Gheg)', label: 'Albanian (Gheg)' });
  assert.ok(languages.some(l => l.id === 'Altai'));
  assert.throws(() => parseLanguages('<html>error</html>'), /selectors/);
  assert.throws(() => parseLanguages(languagesHtml.replace('<option value="Abkhaz">', '<option value="wrong">')), /disagree/);
});
test('parses live Altai/Uzbek markup, Unicode, decimals, statistics and references', () => {
  const c = parseComparison(comparisonHtml, 'Altai', 'Uzbek', url);
  assert.equal(c.distance, 18.43);
  assert.equal(c.similarity, 0.8157);
  assert.equal(c.wordCount, 18);
  assert.equal(c.totalPoints, 1468.33);
  assert.equal(c.meanPoints, 81.574);
  assert.deepEqual(c.statistics, { expectation: 83.82, standardDeviation: 5.43, pValue: 1.03e-33 });
  assert.equal(c.words[0].concept, 'Death');
  assert.match(c.words[0].source.text, /Öl \(ӧл\)/);
  assert.equal(c.words.find(w => w.concept === 'Water')?.points, 85);
  assert.match(c.references, /Natalie Henkel/);
  assert.equal(c.referenceLinks.length, 2);
});
test('rejects wrong pair, missing analysis and incomplete word tables', () => {
  assert.throws(() => parseComparison(comparisonHtml, 'English', 'German', url), /heading/);
  assert.throws(() => parseComparison(comparisonHtml.replace('Distance: 18,43', 'No distance'), 'Altai', 'Uzbek', url), /missing/);
  assert.throws(() => parseComparison(comparisonHtml.replace("class='WordResultFirst'", "class='other'"), 'Altai', 'Uzbek', url), /count mismatch/);
});
test('encodes exact IDs safely in query parameters', () => {
  const u = new URL(comparisonUrl('A & B', 'Chinese_(Wu_Shanghai)'));
  assert.equal(u.searchParams.get('Language1'), 'A & B');
  assert.equal(u.searchParams.get('Language2'), 'Chinese_(Wu_Shanghai)');
  assert.equal(u.searchParams.get('Order'), 'Details');
});
test('CLI retains only JSON, resumes without requests, and refetches missing results', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'language-map-test-'));
  let requests = 0;
  const server = createServer((req, res) => {
    requests++;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(req.url?.includes('Language1=') ? comparisonHtml : languagesHtml);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/Compare_Languages.aspx`;
  const run = (script: string, ...extra: string[]) => promisify(execFile)(process.execPath,
    ['--import', 'tsx', `scripts/${script}.ts`, '--data-dir', dir, '--base-url', base, '--delay-ms', '0', ...extra]);
  try {
    await run('languages');
    await assert.rejects(readdir(join(dir, 'raw')), { code: 'ENOENT' });
    await run('compare', '--languages', 'Uzbek,Altai', '--limit', '1');
    assert.equal(requests, 2);
    const graph = JSON.parse(await readFile(join(dir, 'graph.json'), 'utf8'));
    assert.equal(graph.complete, true);
    assert.equal(graph.directed, false);
    assert.equal(graph.edges[0].distance, 18.43);
    assert.equal(graph.nodes.length, 2);
    await run('compare', '--languages', 'Altai,Uzbek');
    assert.equal(requests, 2);
    const files = await readdir(join(dir, 'comparisons'));
    await rm(join(dir, 'comparisons', files[0]));
    await run('compare', '--languages', 'Altai,Uzbek');
    assert.equal(requests, 3);
    await assert.rejects(readdir(join(dir, 'raw')), { code: 'ENOENT' });
    assert.match(await readFile(join(dir, 'edges.csv'), 'utf8'), /"18.43"/);
    await run('compare', '--languages', 'Altai,Uzbek,English', '--export-only');
    assert.equal(JSON.parse(await readFile(join(dir, 'graph.json'), 'utf8')).complete, false);
    assert.equal(requests, 3);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
test('legacy cleanup removes only generated HTML under data/raw and preserves parsed results', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'language-html-cleanup-'));
  try {
    await mkdir(join(dir, 'raw'));
    await writeFile(join(dir, 'raw', 'old.html'), '<html>obsolete</html>');
    await writeFile(join(dir, 'raw', 'languages.HTML'), '<html>obsolete</html>');
    await writeFile(join(dir, 'raw', 'notes.txt'), 'keep');
    await writeFile(join(dir, 'languages.json'), '{"languages":[]}');
    assert.equal(await removeRawHtml(dir), 2);
    assert.deepEqual(await readdir(join(dir, 'raw')), ['notes.txt']);
    assert.equal(await readFile(join(dir, 'languages.json'), 'utf8'), '{"languages":[]}');
    assert.equal(await removeRawHtml(dir), 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
