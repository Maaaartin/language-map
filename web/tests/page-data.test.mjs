import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { embedCatalog, catalogPlaceholder } from '../../scripts/html-pages.mjs';
import { readLanguageData } from '../dist/page-data.js';

test('embedded catalog safely round-trips scraped labels and is parsed once for reuse', () => {
  const metadata = { comparisonCount: 12, languages: [{ id: 'A', label: '</script><script>alert(1)</script>&\u2028\u2029$&' }] };
  const html = embedCatalog(`<html><head>${catalogPlaceholder}</head></html>`, metadata);
  const dom = new JSDOM(html);
  try {
    assert.equal(dom.window.document.querySelectorAll('script').length, 1);
    assert.deepEqual(readLanguageData(dom.window.document), metadata);
    const first = readLanguageData(dom.window.document);
    dom.window.document.getElementById('language-data').textContent = 'invalid';
    assert.equal(readLanguageData(dom.window.document), first);
  } finally { dom.window.close(); }
});

test('missing or malformed embedded data reports an error without fetching a fallback', () => {
  for (const html of ['', '<script id="language-data" type="application/json">{</script>',
    '<script id="language-data" type="application/json">{ "languages": null }</script>']) {
    const dom = new JSDOM(html);
    try { assert.throws(() => readLanguageData(dom.window.document)); }
    finally { dom.window.close(); }
  }
  assert.throws(() => embedCatalog('<html></html>', { languages: [] }), /placeholder/);
  assert.throws(() => embedCatalog(catalogPlaceholder + catalogPlaceholder, { languages: [] }), /exactly one/);
});

test('page counts are injected into HTML and visible without running JavaScript', async () => {
  const { readFile } = await import('node:fs/promises');
  const template = await readFile(new URL('../src/index.html', import.meta.url), 'utf8');
  const metadata = { languages: Array.from({ length: 1234 }, (_, id) => ({ id: String(id) })), comparisonCount: 56789 };
  const html = embedCatalog(template, metadata);
  const dom = new JSDOM(html);
  try {
    assert.equal(dom.window.document.getElementById('node-count').textContent, '1,234');
    assert.equal(dom.window.document.getElementById('pair-count').textContent, '56,789');
    assert.equal(html.includes('<!-- LANGUAGE_COUNT -->'), false);
    assert.equal(html.includes('<!-- COMPARISON_COUNT -->'), false);
  } finally { dom.window.close(); }
  const counts = `${catalogPlaceholder}<!-- LANGUAGE_COUNT -->|<!-- COMPARISON_COUNT -->`;
  assert.match(embedCatalog(counts, { languages: [], comparisonCount: 0 }), /0\|0$/);
  assert.match(embedCatalog(counts, { languages: [] }), /0\|—$/);
});
