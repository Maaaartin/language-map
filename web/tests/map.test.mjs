import { embedCatalog, preparePage } from '../../scripts/html-pages.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import { JSDOM } from 'jsdom';
import { createHash } from 'node:crypto';
import { prepareLocations, groupLocations, closestMappedLanguages } from '../dist/map-model.js';
import { similarityWidth } from '../dist/edge-style.js';
import { normalizeGraph } from '../dist/model.js';

const matched = (id, latitude, longitude, level = 'language') => ({ id, label: id, matchStatus: 'matched',
  glottolog: { name: id, latitude, longitude, level, countries: ['GE', 'RU'], iso6393: 'abk', glottocode: 'abkh1244' } });
const data = { languages: [matched('Abkhaz', 43.056218, 41.159115), matched('Shared point', 43.056218, 41.159115, 'family'),
  matched('Zero coordinates', 0, 0, 'dialect'), matched('Missing', null, null), { id: 'Unmatched', label: 'Unmatched', matchStatus: 'unmatched', glottolog: null }] };
const pathFor = id => `/graphs/${createHash('sha256').update(id).digest('hex')}.json`;
const comparisonNodes = data.languages.map(({ id, label }) => ({ id, label }));
const comparisonEdges = [
  { source: 'Abkhaz', target: 'Missing', distance: 1 },
  { source: 'Abkhaz', target: 'Unmatched', distance: 2 },
  { source: 'Abkhaz', target: 'Zero coordinates', distance: 5 },
  { source: 'Abkhaz', target: 'Shared point', distance: 60 },
  { source: 'Zero coordinates', target: 'Shared point', distance: 80 },
];

test('map data keeps legitimate zero coordinates, skips missing/invalid coordinates, and groups identical points', () => {
  const prepared = prepareLocations({ languages: [...data.languages, matched('Bad latitude', 91, 1), matched('Bad longitude', 10, 181), matched('Non-finite', NaN, 0)] });
  assert.equal(prepared.records.length, 3); assert.equal(prepared.withoutLocation, 5);
  assert.deepEqual(groupLocations(prepared.records).map(g => g.records.length).sort(), [1, 2]);
  assert.ok(prepared.records.some(r => r.latitude === 0 && r.longitude === 0));
  assert.throws(() => prepareLocations({}), /languages array/);
});
test('closest matches are ranked after excluding missing locations', () => {
  const graph = normalizeGraph({ nodes: comparisonNodes, edges: comparisonEdges });
  const result = closestMappedLanguages(graph, prepareLocations(data).records, 'Abkhaz', 1);
  assert.equal(result.connections[0].target.id, 'Zero coordinates');
  assert.equal(result.connections[0].similarity, .95);
  assert.equal(result.withoutLocation, 2); assert.equal(result.totalMapped, 2);
});

let instance = 0;
async function withMap(url, run, { fail = false, graphResponse, basePath = '' } = {}) {
  const html = await readFile(new URL('../src/map/index.html', import.meta.url), 'utf8');
  const leaflet = await readFile(new URL('../../node_modules/leaflet/dist/leaflet-src.js', import.meta.url), 'utf8');
  const metadata = { languages: comparisonNodes.map(n => ({ ...n, graphFile: pathFor(n.id) })), comparisonCount: comparisonEdges.length };
  const dom = new JSDOM(embedCatalog(preparePage(html, basePath), metadata), { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom, document = window.document;
  const container = document.getElementById('geographic-map');
  for (const [key, value] of Object.entries({ clientWidth: 1000, clientHeight: 650, offsetWidth: 1000, offsetHeight: 650 })) Object.defineProperty(container, key, { value });
  window.SVGSVGElement.prototype.createSVGRect = () => ({});
  window.eval(leaflet); // Exercise real Leaflet markers/lines/popups without requesting external tiles.
  const requests = [];
  const globals = { window, document,
    ResizeObserver: class { observe() {} disconnect() {} },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (url === basePath + '/languages-enriched.json') return { ok: !fail, status: fail ? 404 : 200, json: async () => data };
      const center = comparisonNodes.find(n => basePath + pathFor(n.id) === url)?.id;
      assert.ok(center, `Unexpected comparison request: ${url}`);
      const edges = comparisonEdges.filter(e => e.source === center || e.target === center);
      const ids = new Set([center, ...edges.flatMap(e => [e.source, e.target])]);
      let body = { center, nodes: comparisonNodes.filter(n => ids.has(n.id)), edges };
      if (graphResponse) body = await graphResponse(center, body);
      return { ok: true, json: async () => body };
    },
  };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  try {
    const module = await import(`../dist/map.js?instance=${++instance}`);
    await run({ window, document, requests, map: module.map, L: window.L });
  } finally {
    window.dispatchEvent(new window.Event('pagehide'));
    window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
}

test('Pages nested map loads prefixed coordinates and graphs and links back to the project root', async () => {
  await withMap('https://maaaartin.github.io/language-map/map/?language=Abkhaz', async ({ window, document, requests }) => {
    assert.deepEqual(requests.map(r => r.url), ['/language-map/languages-enriched.json', '/language-map' + pathFor('Abkhaz')]);
    const link = new URL(document.getElementById('graph-link').href);
    assert.equal(link.pathname, '/language-map/');
    assert.equal(link.searchParams.get('language'), 'Abkhaz');
    assert.equal(window.location.pathname, '/language-map/map/');
    assert.match(document.querySelector('.geo-popup a').getAttribute('href'), /^\/language-map\/\?language=/);
    assert.equal(document.querySelector('link[rel="preload"]').getAttribute('href'), '/language-map/languages-enriched.json');
  }, { basePath: '/language-map' });
});

test('geographic page loads enriched JSON and real Leaflet pins at latitude/longitude with safe popups and search', async () => {
  await withMap('http://localhost/map', async ({ window, document, requests, map, L }) => {
    assert.deepEqual(requests, [{ url: '/languages-enriched.json', options: { cache: 'default', priority: 'high' } }]);
    assert.equal(document.getElementById('located-count').textContent, '3');
    assert.equal(document.getElementById('unlocated-count').textContent, '2');
    const markers = [];
    map.eachLayer(layer => { if (layer instanceof L.Marker) markers.push(layer); });
    assert.equal(markers.length, 2);
    assert.ok(markers.some(marker => marker.getLatLng().lat === 43.056218 && marker.getLatLng().lng === 41.159115));
    assert.ok(markers.some(marker => marker.getLatLng().lat === 0 && marker.getLatLng().lng === 0));
    assert.equal(document.querySelectorAll('.leaflet-marker-icon').length, 2);
    const button = document.querySelector('button[data-language="Abkhaz"]'); button.click();
    await setImmediate();
    assert.equal(new URL(window.location.href).searchParams.get('language'), 'Abkhaz');
    assert.match(document.querySelector('.geo-popup').textContent, /Abkhaz/);
    assert.match(document.querySelector('.geo-popup').textContent, /Shared point/);
    assert.match(document.querySelector('.geo-popup').textContent, /43\.0562, 41\.1591/);
    assert.match(document.querySelector('.geo-popup a').getAttribute('href'), /language=Abkhaz/);
    assert.match(document.getElementById('graph-link').href, /\?language=Abkhaz/);
    assert.ok(document.querySelector('.leaflet-control-attribution a[href="https://www.openstreetmap.org/copyright"]'));
    const search = document.getElementById('map-search'); search.value = 'Zero'; search.dispatchEvent(new window.Event('input'));
    assert.equal(document.querySelectorAll('#language-list button').length, 1);
    assert.equal(document.querySelectorAll('.leaflet-marker-icon').length, 1);
    search.value = 'nothing matches'; search.dispatchEvent(new window.Event('input'));
    assert.equal(document.querySelectorAll('.leaflet-marker-icon').length, 0);
    assert.match(document.getElementById('language-list').textContent, /No mapped languages/);
    search.value = ''; search.dispatchEvent(new window.Event('input'));
    const level = document.getElementById('map-level'); level.value = 'family'; level.dispatchEvent(new window.Event('change'));
    assert.equal(document.querySelectorAll('#language-list button').length, 1);
    assert.equal(document.querySelector('#language-list button').dataset.language, 'Shared point');
  });
});

test('selecting a language automatically loads closest matches and draws shared-scale lines that can highlight a pair', async () => {
  await withMap('http://localhost/map', async ({ window, document, map, L, requests }) => {
    const lines = () => { const result = []; map.eachLayer(layer => { if (layer instanceof L.Polyline) result.push(layer); }); return result; };
    assert.equal(lines().length, 0); assert.equal(requests.length, 1);
    document.querySelector('button[data-language="Abkhaz"]').click(); await setImmediate();
    assert.deepEqual(requests.map(r => r.url), ['/languages-enriched.json', pathFor('Abkhaz')]);
    assert.equal(lines().length, 2);
    assert.equal(document.querySelectorAll('#closest-list button').length, 2);
    assert.equal(document.querySelector('#closest-list button').dataset.language, 'Zero coordinates');
    assert.match(document.getElementById('closest-status').textContent, /2 comparisons have no mapped coordinates/);
    assert.deepEqual(lines().map(line => line.options.weight).sort((a, b) => a - b), [similarityWidth(.4), similarityWidth(.95)]);
    const strong = lines().find(line => line.options.weight === similarityWidth(.95));
    assert.deepEqual(Array.from(strong.getLatLngs(), point => [point.lat, point.lng]), [[43.056218, 41.159115], [0, 0]]);
    const url = new URL(window.location.href); assert.equal(url.searchParams.get('connections'), 'closest');
    document.querySelector('#closest-list button').click();
    assert.equal(strong.options.color, '#c7943f'); assert.equal(strong.options.weight, similarityWidth(.95));
    assert.equal(new URL(window.location.href).searchParams.get('compare'), 'Zero coordinates');
    assert.match(document.querySelector('.leaflet-popup-content a').href, /language=Abkhaz&compare=Zero/);
    document.getElementById('clear-closest').click();
    assert.equal(lines().length, 0);
    assert.equal(new URL(window.location.href).searchParams.get('language'), 'Abkhaz');
    assert.equal(new URL(window.location.href).searchParams.get('connections'), 'none');
    assert.equal(document.getElementById('closest-panel').hidden, true);
  });
});

test('closest connections and highlighted pair restore from a map URL', async () => {
  await withMap('http://localhost/map?language=Abkhaz&connections=closest&compare=Zero%20coordinates', async ({ map, L, document }) => {
    const lines = []; map.eachLayer(layer => { if (layer instanceof L.Polyline) lines.push(layer); });
    assert.equal(lines.length, 2);
    assert.ok(lines.some(line => line.options.color === '#c7943f' && line.options.weight === similarityWidth(.95)));
    assert.equal(document.querySelector('#closest-list button[aria-pressed="true"]').dataset.language, 'Zero coordinates');
  });
});

test('failed comparison requests can retry without reloading the language index', async () => {
  let fail = true;
  await withMap('http://localhost/map', async ({ document, requests }) => {
    document.querySelector('button[data-language="Abkhaz"]').click();
    await setImmediate();
    assert.equal(document.getElementById('retry-closest').hidden, false);
    assert.match(document.getElementById('closest-status').textContent, /Could not load comparisons/);
    fail = false; document.getElementById('retry-closest').click(); await setImmediate();
    assert.equal(document.querySelectorAll('#closest-list button').length, 2);
    assert.equal(requests.filter(r => r.url === '/languages.json').length, 0);
    assert.equal(requests.filter(r => r.url === pathFor('Abkhaz')).length, 2);
  }, { graphResponse: async (_, body) => { if (fail) throw new Error('temporarily unavailable'); return body; } });
});

test('a late closest-graph response cannot overwrite a newly selected map language', async () => {
  let release;
  const slow = new Promise(resolve => { release = resolve; });
  await withMap('http://localhost/map', async ({ window, document, map, L, requests }) => {
    document.querySelector('button[data-language="Abkhaz"]').click();
    await setImmediate();
    document.querySelector('#language-list button[data-language="Zero coordinates"]').click();
    await setImmediate();
    release(); await setImmediate();
    assert.match(document.getElementById('closest-title').textContent, /Closest to Zero coordinates/);
    assert.equal(new URL(window.location.href).searchParams.get('language'), 'Zero coordinates');
    const lines = []; map.eachLayer(layer => { if (layer instanceof L.Polyline) lines.push(layer); });
    assert.ok(lines.every(line => line.getLatLngs()[0].lat === 0));
    assert.equal(requests.filter(r => r.url === '/languages.json').length, 0);
  }, { graphResponse: async (center, body) => { if (center === 'Abkhaz') await slow; return body; } });
});

test('map URL restores a selected language and data errors offer a retry', async () => {
  await withMap('http://localhost/map?language=Abkhaz&compare=English', async ({ document, map }) => {
    assert.equal(document.querySelector('button[data-language="Abkhaz"]').getAttribute('aria-pressed'), 'true');
    assert.match(document.querySelector('.geo-popup').textContent, /Abkhaz/);
    assert.ok(map.getBounds().contains([43.056218, 41.159115]));
    assert.match(document.getElementById('graph-link').href, /compare=English/);
  });
  await withMap('http://localhost/map', async ({ document }) => {
    assert.match(document.getElementById('geo-status').textContent, /npm run map:languages/);
    assert.equal(document.getElementById('retry-locations').hidden, false);
    await setImmediate();
  }, { fail: true });
});

test('native pin and edge clicks keep selection, while clicking the map background clears it', async () => {
  await withMap('http://localhost/map?keep=yes', async ({ window, document, map, L }) => {
    const marker = [...document.querySelectorAll('.leaflet-marker-icon')].find(n => n.title.includes('Abkhaz'));
    marker.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await setImmediate();
    assert.equal(new URL(window.location.href).searchParams.get('language'), 'Abkhaz');
    assert.equal(new URL(window.location.href).searchParams.get('connections'), 'closest');
    assert.ok(document.querySelector('.map-marker.is-active'));
    assert.equal(document.getElementById('closest-panel').hidden, false);
    const lines = []; map.eachLayer(layer => { if (layer instanceof L.Polyline) lines.push(layer); });
    assert.equal(lines.length, 2);
    lines[0].getElement().dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(new URL(window.location.href).searchParams.get('language'), 'Abkhaz');
    assert.ok(new URL(window.location.href).searchParams.has('compare'));
    document.getElementById('geographic-map').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const url = new URL(window.location.href);
    assert.equal(url.searchParams.has('language'), false);
    assert.equal(url.searchParams.has('compare'), false);
    assert.equal(url.searchParams.has('connections'), false);
    assert.equal(url.searchParams.get('keep'), 'yes');
    assert.equal(document.querySelector('.map-marker.is-active'), null);
    assert.equal(document.querySelector('.map-marker.is-connected'), null);
    assert.equal(document.querySelector('#language-list button[aria-pressed="true"]'), null);
    assert.equal(document.getElementById('closest-panel').hidden, true);
    assert.equal(Boolean(map._popup?.isOpen()), false);
    assert.ok(lines.every(line => !map.hasLayer(line)));
    assert.ok([...document.querySelectorAll('.leaflet-marker-icon')].every(n => n.style.opacity === '1'));
  });
});

test('deselecting the map ignores a pending comparison response', async () => {
  let release;
  const slow = new Promise(resolve => { release = resolve; });
  await withMap('http://localhost/map', async ({ window, document, map, L }) => {
    document.querySelector('button[data-language="Abkhaz"]').click(); await setImmediate();
    map.fire('click');
    release(); await setImmediate();
    assert.equal(new URL(window.location.href).searchParams.has('language'), false);
    assert.equal(document.getElementById('closest-panel').hidden, true);
    assert.equal(document.querySelector('.map-marker.is-active'), null);
    const lines = []; map.eachLayer(layer => { if (layer instanceof L.Polyline) lines.push(layer); });
    assert.equal(lines.length, 0);
  }, { graphResponse: async (_, body) => { await slow; return body; } });
});

test('an explicitly cleared connection view remains off after reload', async () => {
  await withMap('http://localhost/map?language=Abkhaz&connections=none', async ({ document, requests }) => {
    assert.equal(document.querySelector('#language-list button[aria-pressed="true"]').dataset.language, 'Abkhaz');
    assert.equal(document.getElementById('closest-panel').hidden, true);
    assert.deepEqual(requests.map(r => r.url), ['/languages-enriched.json']);
  });
});
