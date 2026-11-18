import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { graphFileName, writeGraphFiles } from '../scripts/graph-files.js';

test('graph files contain only direct neighbors, index both endpoints, and update only changed languages', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'language-graph-files-'));
  const graph = { nodes: ['A', 'B', 'C', 'D'].map(id => ({ id, label: id })), edges: [
    { source: 'A', target: 'B', distance: 20, words: ['not part of browser data'] },
    { source: 'B', target: 'C', distance: 40, words: [] },
  ] };
  const read = async (id: string) => JSON.parse(await readFile(join(dir, 'languages', graphFileName(id)), 'utf8'));
  try {
    const index = await writeGraphFiles(dir, graph);
    assert.equal(index.comparisonCount, 2);
    assert.equal(index.languages.length, 4);
    assert.equal(index.languages[0].graphFile, `/graphs/${graphFileName('A')}`);
    const a = await read('A'), b = await read('B'), d = await read('D');
    assert.deepEqual(a.nodes.map((n: { id: string }) => n.id), ['A', 'B']);
    assert.equal(a.edges.length, 1); assert.equal(a.edges[0].words, undefined);
    assert.equal(b.edges.length, 2); assert.ok(b.edges.every((e: { source: string; target: string }) => e.source === 'B' || e.target === 'B'));
    assert.deepEqual(d.nodes.map((n: { id: string }) => n.id), ['D']); assert.equal(d.edges.length, 0);
    const unchanged = await readFile(join(dir, 'languages', graphFileName('C')), 'utf8');
    graph.edges.push({ source: 'A', target: 'D', distance: 10, words: [] });
    await writeGraphFiles(dir, graph, new Set(['A', 'D']));
    assert.equal((await read('A')).edges.length, 2);
    assert.equal((await read('D')).edges.length, 1);
    assert.equal(await readFile(join(dir, 'languages', graphFileName('C')), 'utf8'), unchanged);
    assert.equal(JSON.parse(await readFile(join(dir, 'index.json'), 'utf8')).comparisonCount, 3);
    assert.match(graphFileName('../A & B'), /^[a-f0-9]{64}\.json$/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('local endpoints serve the index and a single language without any aggregate graph file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'language-graph-server-'));
  const moduleUrl = new URL('../scripts/web-dev.mjs', import.meta.url).href;
  const { createWebServer } = await import(moduleUrl);
  const server: Server = createWebServer({ dataDirectory: dir, staticDirectory: join(dir, 'static') });
  try {
    await mkdir(join(dir, 'static/map'), { recursive: true });
    await writeFile(join(dir, 'static/index.html'), '<title>Graph</title><!-- LANGUAGE_CATALOG -->');
    await writeFile(join(dir, 'static/map/index.html'), '<title>Geographic map</title><!-- LANGUAGE_CATALOG -->');
    const classification = { status: 'classified', family: { id: 'indo1319', name: 'Indo-European' }, branch: { id: 'germ1287', name: 'Germanic' }, ancestors: [] };
    await writeFile(join(dir, 'languages-enriched.json'), JSON.stringify({ languages: [{ id: 'A', label: 'A', classification }] }));
    await writeGraphFiles(join(dir, 'graph'), { nodes: ['A', 'B', 'C'].map(id => ({ id, label: id })),
      edges: [{ source: 'A', target: 'B', distance: 20 }, { source: 'B', target: 'C', distance: 30 }] });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const index = await (await fetch(`${base}/languages.json`)).json();
    assert.equal(index.comparisonCount, 2);
    assert.equal(index.edges, undefined);
    assert.deepEqual(index.languages[0].classification, classification);
    assert.equal(index.languages[1].classification, null);
    const response = await fetch(`${base}${index.languages[0].graphFile}`);
    const graph = await response.json();
    assert.equal(response.status, 200);
    assert.equal(graph.center, 'A'); assert.equal(graph.edges.length, 1);
    assert.deepEqual(graph.nodes.map((n: { id: string }) => n.id), ['A', 'B']);
    const etag = response.headers.get('etag'); assert.ok(etag);
    assert.equal(response.headers.get('cache-control'), 'no-cache');
    const unchanged = await fetch(`${base}${index.languages[0].graphFile}`, { headers: { 'If-None-Match': etag } });
    assert.equal(unchanged.status, 304); assert.equal(await unchanged.text(), '');
    const page = await fetch(`${base}/?language=A`);
    assert.ok(!page.headers.get('link')!.includes('/languages.json'));
    assert.ok(page.headers.get('link')!.includes(`<${index.languages[0].graphFile}>`));
    const pageTag = page.headers.get('etag')!;
    const pageHtml = await page.text();
    const embedded = JSON.parse(pageHtml.match(/<script id="language-data" type="application\/json">([\s\S]*?)<\/script>/)![1]);
    assert.equal(embedded.comparisonCount, 2);
    assert.deepEqual(embedded.languages[0].classification, classification);
    assert.equal((await fetch(`${base}/?language=unknown`)).headers.get('link'), null);
    assert.ok((await fetch(`${base}/map?language=A`)).headers.get('link')!.includes(`<${index.languages[0].graphFile}>`));
    const noConnections = (await fetch(`${base}/map?language=A&connections=none`)).headers.get('link')!;
    assert.ok(noConnections.includes('/languages-enriched.json'));
    assert.ok(!noConnections.includes('/graphs/'));
    assert.equal((await fetch(`${base}/graph.json`)).status, 404);
    assert.equal((await fetch(`${base}/graphs/invalid.json`)).status, 404);
    for (const path of ['/map', '/map/', '/map/index.html']) {
      const response = await fetch(base + path);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type')!, /text\/html/);
      assert.match(await response.text(), /Geographic map/);
    }
    const enriched = await (await fetch(`${base}/languages-enriched.json`)).json();
    assert.equal(enriched.languages[0].id, 'A');
    await writeGraphFiles(join(dir, 'graph'), { nodes: ['A', 'B', 'C'].map(id => ({ id, label: id })),
      edges: [{ source: 'A', target: 'B', distance: 5 }] });
    const updated = await fetch(`${base}${index.languages[0].graphFile}`, { headers: { 'If-None-Match': etag } });
    assert.equal(updated.status, 200); assert.notEqual(updated.headers.get('etag'), etag);
    assert.equal((await updated.json()).edges[0].distance, 5);
    const refreshedPage = await fetch(`${base}/?language=A`, { headers: { 'If-None-Match': pageTag } });
    assert.equal(refreshedPage.status, 200);
    const refreshed = await refreshedPage.text();
    assert.equal(JSON.parse(refreshed.match(/<script id="language-data" type="application\/json">([\s\S]*?)<\/script>/)![1]).comparisonCount, 1);
  } finally {
    if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
