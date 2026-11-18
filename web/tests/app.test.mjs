import { embedCatalog, preparePage } from '../../scripts/html-pages.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import { JSDOM } from 'jsdom';
import * as d3 from 'd3';
import { createHash } from 'node:crypto';
import { similarityWidth } from '../dist/edge-style.js';

const input = { nodes: ['A', 'B', 'C', 'D'].map(id => ({ id, label: id })), edges: [
  { source: 'A', target: 'B', distance: 10 }, { source: 'B', target: 'C', distance: 60 },
  { source: 'A', target: 'D', distance: 30 },
] };
let instance = 0;
const pathFor = id => `/graphs/${createHash('sha256').update(id).digest('hex')}.json`;
async function withApp(url, run, { fetchGraph, data = input, basePath = '' } = {}) {
  const html = await readFile(new URL('../src/index.html', import.meta.url), 'utf8');
  const metadata = { languages: data.nodes.map(n => ({ ...n, graphFile: pathFor(n.id) })), comparisonCount: data.edges.length };
  const dom = new JSDOM(embedCatalog(preparePage(html, basePath), metadata), { url });
  const { window } = dom, document = window.document;
  const map = document.querySelector('.map');
  let width = 800, height = 650, resized;
  Object.defineProperty(map, 'clientWidth', { get: () => width });
  Object.defineProperty(map, 'clientHeight', { get: () => height });
  window.d3 = d3; window.matchMedia = () => ({ matches: true });
  const frames = new Map(); let frameId = 0;
  const requests = [];
  const globals = {
    window, document, SVGElement: window.SVGElement,
    requestAnimationFrame: callback => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: id => frames.delete(id),
    ResizeObserver: class { constructor(callback) { resized = callback; } observe() {} },
    fetch: async (url, options) => {
      requests.push({ url, options });
      const center = data.nodes.find(n => basePath + pathFor(n.id) === url)?.id;
      assert.ok(center, `Unexpected data request: ${url}`);
      const edges = data.edges.filter(e => e.source === center || e.target === center);
      const ids = new Set([center, ...edges.flatMap(e => [e.source, e.target])]);
      let body = { center, nodes: data.nodes.filter(n => ids.has(n.id)), edges };
      if (fetchGraph) body = await fetchGraph(center, body);
      return { ok: true, json: async () => body };
    },
  };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  const flushFrame = () => { const [id, callback] = frames.entries().next().value; frames.delete(id); callback(0); };
  const clickNode = async id => {
    const node = [...document.querySelectorAll('.node')].find(n => n.__data__.id === id);
    assert.ok(node, `Expected a visible node for ${id}`);
    node.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await setImmediate();
  };
  const assertCentered = id => {
    const selected = document.querySelector('.node[aria-pressed="true"]');
    assert.equal(selected?.__data__.id, id);
    const n = selected.__data__, camera = d3.zoomTransform(document.getElementById('graph'));
    const [x, y] = camera.apply([n.x, n.y]);
    assert.ok(Math.abs(x - width / 2) < 1e-6); assert.ok(Math.abs(y - height / 2) < 1e-6);
    assert.equal(n.fx, width / 2); assert.equal(n.fy, height / 2);
    assert.equal(new URL(window.location.href).searchParams.get('language'), id);
  };
  const chooseStart = async text => {
    const search = document.getElementById('start-search'); search.value = text;
    search.dispatchEvent(new window.Event('input'));
    search.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown' }));
    assert.ok(search.getAttribute('aria-activedescendant'));
    search.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }));
    await setImmediate();
  };
  const navigate = async direction => {
    const event = new Promise(resolve => window.addEventListener('popstate', () => { setImmediate().then(resolve); }, { once: true }));
    window.history[direction](); await event;
  };
  try {
    const boot = import(`../dist/app.js?instance=${++instance}`);
    await boot;
    await run({ window, document, requests, flushFrame, clickNode, assertCentered, chooseStart, navigate,
      resize: (w, h) => { width = w; height = h; resized(); } });
  } finally {
    window.dispatchEvent(new window.Event('pagehide'));
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
}

test('Pages project path is preserved in graph requests, navigation, and URL state', async () => {
  await withApp('https://maaaartin.github.io/language-map/?language=A', async ({ window, document, requests, clickNode }) => {
    assert.deepEqual(requests.map(r => r.url), ['/language-map' + pathFor('A')]);
    assert.equal(new URL(document.getElementById('geography-link').href).pathname, '/language-map/map/');
    await clickNode('B');
    assert.equal(window.location.pathname, '/language-map/');
    const link = new URL(document.getElementById('geography-link').href);
    assert.equal(link.pathname, '/language-map/map/');
    assert.equal(link.searchParams.get('compare'), 'B');
    assert.equal(new URL(document.querySelector('script[type="module"]').src).pathname, '/language-map/app.js');
  }, { basePath: '/language-map' });
});

test('searchable start selector loads only names, then fetches comparisons and preserves the two-click interaction', async () => {
  await withApp('http://localhost/', async ({ window, document, requests, flushFrame, clickNode, assertCentered, chooseStart, resize }) => {
    assert.deepEqual(requests, []);
    assert.equal(document.querySelectorAll('.node').length, 0);
    assert.equal(document.getElementById('start-panel').hidden, false);
    await chooseStart('B'); assertCentered('B');
    assert.equal(document.getElementById('start-panel').hidden, true);
    assert.deepEqual(requests.map(r => r.url), [pathFor('B')]);
    assert.equal(document.getElementById('display-all'), null);
    assert.deepEqual([...document.querySelectorAll('.node')].map(n => n.__data__.id), ['A', 'B', 'C', 'D']);
    const before = [...document.querySelectorAll('.node')].map(n => [n.__data__.id, n.__data__.x, n.__data__.y]);
    for (const edge of document.querySelectorAll('.edge')) assert.equal(Number(edge.getAttribute('stroke-width')), similarityWidth(edge.__data__.similarity));
    await clickNode('A'); assertCentered('B');
    assert.equal(requests.length, 1); // Inspecting a pair reuses the centered language's graph.
    assert.equal(new URL(window.location.href).searchParams.get('compare'), 'A');
    assert.equal(document.querySelector('.node[data-comparison="true"]').__data__.id, 'A');
    assert.equal(document.querySelectorAll('.edge.compared').length, 1);
    for (const edge of document.querySelectorAll('.edge')) assert.equal(Number(edge.getAttribute('stroke-width')), similarityWidth(edge.__data__.similarity));
    assert.match(document.querySelector('.comparison-card').textContent, /90% similarity/);
    assert.deepEqual([...document.querySelectorAll('.node')].map(n => [n.__data__.id, n.__data__.x, n.__data__.y]), before);
    await clickNode('C'); assertCentered('B');
    assert.equal(new URL(window.location.href).searchParams.get('compare'), 'C');
    assert.equal(requests.length, 1); // A different comparison keeps the current center.
    await clickNode('C'); assertCentered('C');
    assert.equal(requests.at(-1).url, pathFor('C'));
    assert.equal(new URL(window.location.href).searchParams.has('compare'), false);
    await clickNode('B'); assertCentered('C'); await clickNode('B'); assertCentered('B');
    assert.equal(requests.filter(request => request.url === pathFor('B')).length, 1);
    const threshold = document.getElementById('threshold');
    threshold.value = '80'; threshold.dispatchEvent(new window.Event('input')); flushFrame(); assertCentered('B');
    assert.equal(new URL(window.location.href).searchParams.get('similarity'), '80');
    resize(1100, 750); assertCentered('B');
    await clickNode('A'); assertCentered('B'); await clickNode('A'); assertCentered('A');
    const search = document.getElementById('search');
    search.value = 'C'; search.dispatchEvent(new window.Event('input'));
    document.querySelector('#search-results button').click(); await setImmediate(); assertCentered('A');
    assert.match(document.querySelector('.comparison-card').textContent, /No comparison collected/);
    search.value = 'C'; search.dispatchEvent(new window.Event('input'));
    document.querySelector('#search-results button').click(); await setImmediate(); assertCentered('C');
    threshold.value = '10'; threshold.dispatchEvent(new window.Event('input')); flushFrame();
    await clickNode('B'); assertCentered('C');
    const requestCount = requests.length;
    assert.equal(document.getElementById('file'), null);
    assert.equal(document.getElementById('import'), null);
    assert.equal(document.querySelector('.node[data-comparison="true"]').__data__.id, 'B');
    document.getElementById('graph').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assertCentered('C');
    assert.equal(document.querySelector('.node[data-comparison="true"]').__data__.id, 'B');
    assert.equal(new URL(window.location.href).searchParams.get('compare'), 'B');
    document.querySelector('button[aria-label="Clear language selection"]').click();
    assert.equal(document.querySelectorAll('.node').length, 0);
    assert.equal(document.getElementById('start-panel').hidden, false);
    assert.equal(new URL(window.location.href).searchParams.has('language'), false);
    assert.equal(new URL(window.location.href).searchParams.has('compare'), false);
    await chooseStart('A'); assertCentered('A');
    assert.equal(requests.length, requestCount); // Returning to a cached center reuses its graph.
    assert.ok(requests.some(request => request.url === pathFor('A')));
  });
});

test('shared URL restores both languages and filter across fresh loads; Back and Forward restore the graph', async () => {
  const href = 'http://localhost/?language=B&compare=A&similarity=80';
  for (let reload = 0; reload < 2; reload++) await withApp(href, async ({ window, document, requests, assertCentered, clickNode, navigate }) => {
    assertCentered('B');
    assert.equal(document.querySelector('.node[data-comparison="true"]').__data__.id, 'A');
    assert.equal(document.getElementById('threshold').value, '80');
    assert.equal(document.querySelectorAll('.edge.compared').length, 1);
    assert.deepEqual(requests.map(r => r.url), [pathFor('B')]);
    await clickNode('A'); assertCentered('A');
    await navigate('back'); assertCentered('B');
    assert.equal(document.querySelector('.node[data-comparison="true"]').__data__.id, 'A');
    await navigate('forward'); assertCentered('A');
    assert.equal(document.querySelector('.node[data-comparison="true"]'), null);
    assert.deepEqual(requests.map(r => r.url), [pathFor('B'), pathFor('A')]);
  });
});

test('invalid language URLs show the chooser and never download comparisons', async () => {
  await withApp('http://localhost/?language=missing&compare=A&similarity=bogus', async ({ window, document, requests }) => {
    assert.equal(document.querySelectorAll('.node').length, 0);
    assert.equal(document.getElementById('start-panel').hidden, false);
    assert.equal(window.location.search, '');
    assert.deepEqual(requests.map(r => r.url), []);
  });
});

test('a slower language request cannot replace a more recently selected center', async () => {
  let release;
  const slow = new Promise(resolve => { release = resolve; });
  await withApp('http://localhost/', async ({ document, chooseStart, assertCentered, requests }) => {
    await chooseStart('B'); // B's request is deliberately still pending.
    const search = document.getElementById('search');
    search.value = 'A'; search.dispatchEvent(new document.defaultView.Event('input'));
    document.querySelector('#search-results button').click(); await setImmediate();
    assertCentered('A');
    release(); await setImmediate(); assertCentered('A');
    assert.deepEqual(requests.map(r => r.url), [pathFor('B'), pathFor('A')]);
  }, { fetchGraph: async (center, body) => { if (center === 'B') await slow; return body; } });
});

test('a failed per-language fetch leaves the selector available for a fresh retry', async () => {
  let fail = true;
  await withApp('http://localhost/', async ({ document, chooseStart, assertCentered, requests }) => {
    await chooseStart('B');
    assert.equal(document.getElementById('start-panel').hidden, false);
    assert.match(document.getElementById('start-status').textContent, /Could not load comparisons/);
    fail = false;
    await chooseStart('B'); assertCentered('B');
    assert.deepEqual(requests.map(r => r.url), [pathFor('B'), pathFor('B')]);
  }, { fetchGraph: async (_, body) => { if (fail) throw new Error('network unavailable'); return body; } });
});


test('automatic threshold shows at most the nearest 20 and adapts when centering another language', async () => {
  const data = {
    nodes: ['A', ...Array.from({ length: 25 }, (_, i) => `N${i}`), 'missing'].map(id => ({ id, label: id })),
    edges: Array.from({ length: 25 }, (_, i) => ({ source: 'A', target: `N${i}`, distance: i + 1 })),
  };
  await withApp('http://localhost/?language=A', async ({ window, document, assertCentered, clickNode, flushFrame }) => {
    assertCentered('A');
    assert.equal(document.getElementById('threshold').value, '80');
    assert.equal(document.querySelectorAll('.edge').length, 20);
    assert.ok([...document.querySelectorAll('.edge')].every(line => line.__data__.distance <= 20));
    assert.ok(document.querySelector('.node[data-missing-comparison="true"]'));
    assert.equal(new URL(window.location.href).searchParams.has('similarity'), false);
    await clickNode('N0'); await clickNode('N0'); assertCentered('N0');
    assert.equal(document.getElementById('threshold').value, '99');
    assert.equal(document.querySelectorAll('.edge').length, 1);
  }, { data });
  await withApp('http://localhost/?language=A&similarity=0', async ({ document }) => {
    assert.equal(document.getElementById('threshold').value, '0');
    assert.equal(document.querySelectorAll('.edge').length, 25);
  }, { data });
});

test('similarity changes preserve zoom and recenter the selection even when all edges disappear', async () => {
  await withApp('http://localhost/?language=B', async ({ window, document, flushFrame, assertCentered }) => {
    const svg = document.getElementById('graph');
    svg.dispatchEvent(new window.WheelEvent('wheel', { deltaY: -400, clientX: 120, clientY: 180, bubbles: true, cancelable: true, view: window }));
    const camera = d3.zoomTransform(svg);
    const threshold = document.getElementById('threshold');
    for (const value of ['0', '100', '25']) {
      threshold.value = value; threshold.dispatchEvent(new window.Event('input')); flushFrame();
      const next = d3.zoomTransform(svg);
      assert.equal(next.k, camera.k);
      assertCentered('B');
      assert.equal(new URL(window.location.href).searchParams.get('similarity'), value);
      if (value === '100') assert.equal(document.querySelectorAll('.edge').length, 0);
    }
    window.history.pushState(null, '', '?language=B&similarity=50');
    window.dispatchEvent(new window.PopStateEvent('popstate'));
    await setImmediate();
    const next = d3.zoomTransform(svg);
    assert.equal(next.k, camera.k);
    assertCentered('B');
  });
});

test('neighbor-level slider lazily expands a second hop, restores its URL, and returns to one hop', async () => {
  for (const initial of [1, 2]) await withApp(`http://localhost/?language=A&similarity=0${initial === 2 ? '&levels=2' : ''}`, async ({ window, document, requests, assertCentered, navigate }) => {
    const slider = document.getElementById('levels');
    assert.equal(slider.value, String(initial));
    const svg = document.getElementById('graph');
    const scale = d3.zoomTransform(svg).k;
    if (initial === 1) {
      assert.deepEqual(requests.map(r => r.url), [pathFor('A')]);
      slider.value = '2'; slider.dispatchEvent(new window.Event('input'));
      for (let i = 0; i < 5; i++) await setImmediate();
    }
    assert.equal(new URL(window.location.href).searchParams.get('levels'), '2');
    assert.deepEqual(new Set(requests.map(r => r.url)), new Set([pathFor('A'), pathFor('B'), pathFor('D')]));
    const comparisons = [...document.querySelectorAll('.edge')].map(line => [line.__data__.source.id, line.__data__.target.id]);
    assert.equal(comparisons.length, 3);
    assert.ok(comparisons.some(([source, target]) => source === 'B' && target === 'C'));
    const c = [...document.querySelectorAll('.node')].find(n => n.__data__.id === 'C');
    assert.equal(c.getAttribute('data-missing-comparison'), null);
    assertCentered('A');
    if (initial === 1) assert.equal(d3.zoomTransform(svg).k, scale);
    slider.value = '1'; slider.dispatchEvent(new window.Event('input')); await setImmediate();
    assert.equal(new URL(window.location.href).searchParams.has('levels'), false);
    assert.equal(document.querySelectorAll('.edge').length, 2);
    assert.equal([...document.querySelectorAll('.node')].find(n => n.__data__.id === 'C').getAttribute('data-missing-comparison'), 'true');
    await navigate('back');
    assert.equal(slider.value, '2');
    assert.equal(document.querySelectorAll('.edge').length, 3);
  });
});

test('five levels load only the required frontier and render a distinct shape at every depth', async () => {
  const ids = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
  const data = { nodes: ids.map(id => ({ id, label: id })), edges: ids.slice(1).map((id, i) => ({ source: ids[i], target: id, distance: 10 })) };
  await withApp('http://localhost/?language=A&similarity=0&levels=5', async ({ window, document, requests, assertCentered }) => {
    assert.equal(document.getElementById('levels').max, '5');
    assert.equal(document.getElementById('levels').value, '5');
    assert.deepEqual(requests.map(r => r.url), [...ids.slice(0, 5).map(pathFor)]);
    assert.equal(document.querySelectorAll('.edge').length, 5);
    const paths = [];
    for (let level = 1; level <= 5; level++) {
      const node = document.querySelector(`.node[data-neighbor-level="${level}"]`);
      assert.equal(node.__data__.id, ids[level]);
      const core = node.querySelector('.core');
      assert.equal(core.tagName, level === 1 ? 'circle' : 'path');
      if (level > 1) paths.push(core.getAttribute('d'));
      assert.equal(document.querySelectorAll('.edge').length, 5);
    }
    assert.equal(new Set(paths).size, 4);
    const g = [...document.querySelectorAll('.node')].find(n => n.__data__.id === 'G');
    assert.equal(g.getAttribute('data-neighbor-level'), null);
    assert.equal(g.getAttribute('data-missing-comparison'), 'true');
    assertCentered('A');
    const count = requests.length;
    const slider = document.getElementById('levels');
    slider.value = '3'; slider.dispatchEvent(new window.Event('input')); await setImmediate();
    assert.equal(document.querySelectorAll('.edge').length, 3);
    assert.equal(new URL(window.location.href).searchParams.get('levels'), '3');
    slider.value = '5'; slider.dispatchEvent(new window.Event('input'));
    for (let i = 0; i < 5; i++) await setImmediate();
    assert.equal(document.querySelectorAll('.edge').length, 5);
    assert.equal(requests.length, count);
    assertCentered('A');
  }, { data });
});

test('graph uses family and subgroup colors, legend, searchable names, and URL grouping', async () => {
  const family = { id: 'indo1319', name: 'Indo-European' };
  const germanic = { id: 'germ1287', name: 'Germanic' }, slavic = { id: 'slav1255', name: 'Slavic' };
  const classification = branch => ({ status: 'classified', family, branch, ancestors: [family, branch] });
  const data = { nodes: [
    { id: 'A', label: 'English', classification: classification(germanic) },
    { id: 'B', label: 'German', classification: classification(germanic) },
    { id: 'C', label: 'Russian', classification: classification(slavic) },
  ], edges: [{ source: 'A', target: 'B', distance: 10 }, { source: 'A', target: 'C', distance: 20 }] };
  await withApp('http://localhost/?language=A', async ({ window, document, requests, assertCentered }) => {
    assert.match(document.getElementById('family-legend').textContent, /Indo-European \/ Germanic/);
    assert.match(document.getElementById('family-legend').textContent, /Slavic/);
    assert.match(document.querySelector('.language-family').textContent, /Germanic/);
    const cores = [...document.querySelectorAll('.node .core')];
    assert.equal(cores[0].getAttribute('stroke'), cores[1].getAttribute('stroke'));
    assert.notEqual(cores[0].getAttribute('stroke'), cores[2].getAttribute('stroke'));
    const search = document.getElementById('search'); search.value = 'Slavic'; search.dispatchEvent(new window.Event('input'));
    assert.equal(document.querySelector('#search-results button').textContent, 'Russian');
    const count = requests.length;
    const mode = document.getElementById('grouping'); mode.value = 'family'; mode.dispatchEvent(new window.Event('change'));
    await setImmediate();
    assert.equal(new URL(window.location.href).searchParams.get('grouping'), 'family');
    assert.equal(document.querySelectorAll('#family-legend li').length, 1);
    assertCentered('A');
    assert.equal(requests.length, count);
  }, { data });
});

test('hover and focus do not fetch neighbors; centering loads their graph on demand', async () => {
  await withApp('http://localhost/?language=A', async ({ window, document, requests, clickNode, assertCentered }) => {
    const neighbor = [...document.querySelectorAll('.node')].find(n => n.__data__.id === 'B');
    neighbor.dispatchEvent(new window.Event('pointerenter'));
    await setImmediate();
    neighbor.dispatchEvent(new window.Event('focus'));
    await setImmediate();
    assert.equal(requests.filter(request => request.url === pathFor('B')).length, 0);
    await clickNode('B'); assertCentered('A');
    assert.equal(requests.filter(request => request.url === pathFor('B')).length, 0);
    await clickNode('B'); assertCentered('B');
    assert.equal(requests.filter(request => request.url === pathFor('B')).length, 1);
  });
});

test('comparison languages start as expandable groups and remain selectable after expansion', async () => {
  const family = { id: 'ie', name: 'Indo-European' };
  const classification = name => ({ status: 'classified', family, branch: { id: name, name }, ancestors: [family] });
  const data = { nodes: [
    { id: 'Czech', label: 'Czech', classification: classification('Slavic') },
    { id: 'Swedish', label: 'Swedish', classification: classification('Germanic') },
    { id: 'German', label: 'German', classification: classification('Germanic') },
  ], edges: [
    { source: 'Czech', target: 'Swedish', distance: 60 },
    { source: 'Czech', target: 'German', distance: 50 },
  ] };
  await withApp('http://localhost/?language=Czech&groupLanguages=true', async ({ window, document, clickNode, assertCentered, requests }) => {
    assertCentered('Czech');
    assert.equal(document.querySelectorAll('.node').length, 2);
    const group = document.querySelector('.node[data-language-group]');
    assert.match(group.textContent, /Germanic \(2\)/);
    assert.equal(document.querySelector('.edge').__data__.similarity, .5);
    const svg = document.getElementById('graph');
    d3.select(svg).call(d3.zoom().extent([[0, 0], [800, 650]]).transform, d3.zoomIdentity.translate(120, -50).scale(1.7));
    group.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await setImmediate();
    assert.equal(document.querySelectorAll('.node[data-language-group]').length, 0);
    assert.equal(document.querySelectorAll('.node').length, 3);
    assert.equal(requests.length, 1);
    await clickNode('Swedish');
    assertCentered('Czech');
    assert.match(document.querySelector('.comparison-card').textContent, /Czech ↔ Swedish/);
    const collapse = [...document.querySelectorAll('#family-legend button')].find(button => button.textContent.includes('Germanic'));
    assert.equal(collapse.getAttribute('aria-expanded'), 'true');
    collapse.click();
    assert.equal(document.querySelectorAll('.node').length, 2);
    assert.equal(document.querySelector('.comparison-card'), null);
    assertCentered('Czech');
  }, { data });
  await withApp('http://localhost/?language=Czech&compare=Swedish&groupLanguages=true', async ({ document, assertCentered }) => {
    assertCentered('Czech');
    assert.equal(document.querySelector('.node[data-comparison="true"]').__data__.id, 'Swedish');
  }, { data });
});


test('group languages defaults off and toggles without moving the center', async () => {
  const family = { id: 'ie', name: 'Indo-European' };
  const branch = { id: 'germanic', name: 'Germanic' };
  const classification = { status: 'classified', family, branch, ancestors: [family, branch] };
  const data = { nodes: ['Czech', 'Swedish', 'German'].map(id => ({ id, label: id, classification })),
    edges: [{ source: 'Czech', target: 'Swedish', distance: 50 }, { source: 'Czech', target: 'German', distance: 60 }] };
  await withApp('http://localhost/?language=Czech', async ({ window, document, assertCentered, navigate }) => {
    const toggle = document.getElementById('group-languages');
    assert.equal(toggle.checked, false);
    assert.equal(document.querySelectorAll('.node').length, 3);
    assert.equal(document.querySelectorAll('.node[data-language-group]').length, 0);
    toggle.click();
    assert.equal(document.querySelectorAll('.node').length, 2);
    assert.equal(new URL(window.location.href).searchParams.get('groupLanguages'), 'true');
    assertCentered('Czech');
    toggle.click();
    assert.equal(document.querySelectorAll('.node').length, 3);
    assertCentered('Czech');
    await navigate('back');
    assert.equal(toggle.checked, true);
    assert.equal(document.querySelectorAll('.node').length, 2);
    assertCentered('Czech');
  }, { data });
});

test('floating grouping settings move independently of the graph and stay within the viewport', async () => {
  await withApp('http://localhost/?language=A', async ({ window, document, assertCentered }) => {
    const panel = document.getElementById('group-settings');
    const handle = document.getElementById('group-settings-handle');
    assert.equal(panel.contains(document.getElementById('group-languages')), true);
    assert.equal(document.querySelector('.sidebar').contains(panel), false);
    panel.getBoundingClientRect = () => ({ left: parseFloat(panel.style.left) || 600, top: parseFloat(panel.style.top) || 110, width: 260, height: 300 });
    let captured = null;
    handle.setPointerCapture = id => { captured = id; };
    handle.hasPointerCapture = id => captured === id;
    handle.releasePointerCapture = () => { captured = null; };
    const pointer = (type, x, y) => {
      const event = new window.MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      handle.dispatchEvent(event);
    };
    const camera = d3.zoomTransform(document.getElementById('graph'));
    pointer('pointerdown', 620, 120);
    pointer('pointermove', 220, 220);
    assert.equal(panel.style.left, '200px');
    assert.equal(panel.style.top, '210px');
    pointer('pointerup', 220, 220);
    assert.equal(captured, null);
    pointer('pointermove', 500, 500);
    assert.equal(panel.style.left, '200px');
    handle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true }));
    assert.equal(panel.style.left, '160px');
    pointer('pointerdown', 180, 220);
    pointer('pointermove', -1000, -1000);
    pointer('pointercancel', -1000, -1000);
    assert.equal(panel.style.left, '12px');
    assert.equal(panel.style.top, '12px');
    assert.equal(d3.zoomTransform(document.getElementById('graph')), camera);
    assertCentered('A');
    const toggle = document.getElementById('group-languages');
    toggle.click();
    assert.equal(toggle.checked, true);
    assert.equal(panel.style.left, '12px');
    window.dispatchEvent(new window.Event('resize'));
    assert.equal(panel.style.left, '12px');
  });
});
