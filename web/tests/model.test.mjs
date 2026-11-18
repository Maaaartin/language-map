import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGraph, normalizeLanguageGraph, visibleEdges, graphView, neighborhoodView, defaultMinimumSimilarity } from '../dist/model.js';

test('normalizes scraper data without mutation and derives trustworthy similarity', () => {
  const input = { nodes: [{ id: 'A' }, { id: 'B', label: 'Bee' }, { id: 'C' }], edges: [
    { source: 'A', target: 'B', distance: 18.43, similarity: .1 },
    { source: 'A', target: 'C', distance: 90, sourceUrl: 'javascript:alert(1)' },
  ] };
  const graph = normalizeGraph(input);
  assert.equal(graph.edges[0].similarity, .8157);
  assert.equal(graph.edges[1].sourceUrl, null);
  assert.equal(graph.expectedPairs, 3);
  assert.equal(input.nodes[0].label, undefined);
  assert.equal(visibleEdges(graph, .5).edges.length, 1);
  assert.equal(visibleEdges(graph, .1).edges.length, 2);
  assert.equal(visibleEdges(graph, 0, 1).total, 2);
  assert.equal(visibleEdges(graph, 0, 1).edges.length, 1);
});
test('rejects malformed nodes, edges, and repeated undirected comparisons', () => {
  assert.throws(() => normalizeGraph({}), /nodes and edges/);
  assert.throws(() => normalizeGraph({ nodes: [{ id: 'A' }, { id: 'A' }], edges: [] }), /unique/);
  const nodes = [{ id: 'A' }, { id: 'B' }];
  assert.throws(() => normalizeGraph({ nodes, edges: [{ source: 'A', target: 'C', distance: 0 }] }), /known language/);
  assert.throws(() => normalizeGraph({ nodes, edges: [{ source: 'A', target: 'B', distance: -1 }] }), /distance/);
  assert.throws(() => normalizeGraph({ nodes, edges: [{ source: 'A', target: 'B', distance: 1 }, { source: 'B', target: 'A', distance: 1 }] }), /Duplicate/);
});
test('selected view includes only direct comparisons above the threshold', () => {
  const graph = normalizeGraph({ nodes: ['A', 'B', 'C', 'D'].map(id => ({ id })), edges: [
    { source: 'A', target: 'B', distance: 1 },
    { source: 'A', target: 'C', distance: 5 },
    { source: 'C', target: 'D', distance: 40 },
  ] });
  assert.equal(visibleEdges(graph, .1, 1).edges[0].source, 'A');
  assert.equal(visibleEdges(graph, .1, 1, 'D').edges[0].target, 'D');
  assert.equal(visibleEdges(graph, .8, 1, 'D').edges.length, 0);
  assert.equal(graph.edges[0].source, 'A'); // Focus does not reorder the stored data.
});
test('selecting a neighbor replaces the previous hub instead of keeping its unrelated spokes', () => {
  const graph = normalizeGraph({ nodes: ['Abkhaz', 'English', 'German', 'French'].map(id => ({ id })), edges: [
    { source: 'Abkhaz', target: 'English', distance: 20 },
    { source: 'Abkhaz', target: 'German', distance: 30 },
    { source: 'Abkhaz', target: 'French', distance: 40 },
    { source: 'English', target: 'French', distance: 10 },
  ] });
  const focused = graphView(graph, .1, 'English');
  assert.deepEqual(focused.nodes.map(n => n.id), ['Abkhaz', 'English', 'French']);
  assert.equal(focused.edges.length, 2);
  assert.ok(focused.edges.every(e => e.source === 'English' || e.target === 'English'));
  const isolated = graphView(graph, .99, 'English');
  assert.deepEqual(isolated.nodes.map(n => n.id), ['English']);
  assert.equal(isolated.edges.length, 0);
  assert.equal(graphView(graph, .1).nodes.length, 4);
  assert.equal(graphView(graph, .1).edges.length, 4);
  const inspected = graphView(graph, .99, 'English', 1500, 'French');
  assert.deepEqual(inspected.nodes.map(n => n.id), ['English', 'French']);
  assert.equal(inspected.edges.length, 1);
  const missing = graphView(graph, .99, 'English', 1500, 'German');
  assert.deepEqual(missing.nodes.map(n => n.id), ['English', 'German']);
  assert.equal(missing.edges.length, 0);
});
test('language graph responses reject a wrong center, unrelated nodes and unrelated edges', () => {
  const catalog = ['A', 'B', 'C'].map(id => ({ id }));
  const graph = { center: 'A', nodes: catalog.slice(0, 2), edges: [{ source: 'A', target: 'B', distance: 10 }] };
  assert.equal(normalizeLanguageGraph(graph, 'A', catalog).edges.length, 1);
  assert.throws(() => normalizeLanguageGraph(graph, 'B', catalog), /does not match/);
  assert.throws(() => normalizeLanguageGraph({ ...graph, nodes: catalog }, 'A', catalog), /unrelated/);
  assert.throws(() => normalizeLanguageGraph({ ...graph, nodes: catalog, edges: [{ source: 'B', target: 'C', distance: 20 }] }, 'A', catalog), /unrelated comparisons/);
});

test('missing comparisons become isolated catalog nodes while filtered known comparisons stay hidden', () => {
  const catalog = ['A', 'B', 'C', 'D'].map(id => ({ id }));
  const graph = normalizeGraph({ nodes: catalog.slice(0, 3), edges: [
    { source: 'A', target: 'B', distance: 10 },
    { source: 'A', target: 'C', distance: 95 },
  ] });
  const view = graphView(graph, .5, 'A', 1500, null, catalog);
  assert.deepEqual(view.nodes.map(n => n.id), ['A', 'B', 'D']);
  assert.equal(view.nodes.find(n => n.id === 'D').missingComparison, true);
  assert.equal(view.edges.length, 1);
  assert.ok(view.edges.every(e => e.source !== 'D' && e.target !== 'D'));
});

test('automatic threshold handles ties, empty data, and fewer than 20 comparisons', () => {
  const nodes = ['A', ...Array.from({ length: 25 }, (_, i) => `N${i}`)].map(id => ({ id }));
  const graph = normalizeGraph({ nodes, edges: nodes.slice(1).map(n => ({ source: 'A', target: n.id, distance: 20 })) });
  assert.equal(defaultMinimumSimilarity(graph, 'A'), 80);
  const view = graphView(graph, .8, 'A', 20);
  assert.equal(view.edges.length, 20);
  assert.equal(defaultMinimumSimilarity(graph, 'N0'), 80);
  assert.equal(defaultMinimumSimilarity({ edges: [] }, 'A'), 100);
});

test('two levels merge real neighbor comparisons without duplicates or third-hop edges', () => {
  const catalog = ['A', 'B', 'C', 'D', 'E'].map(id => ({ id }));
  const root = normalizeGraph({ nodes: catalog.slice(0, 2), edges: [{ source: 'A', target: 'B', distance: 10 }] });
  const branches = new Map([['B', normalizeGraph({ nodes: catalog.slice(0, 4), edges: [
    { source: 'A', target: 'B', distance: 10 }, { source: 'B', target: 'C', distance: 20 },
    { source: 'B', target: 'D', distance: 90 },
  ] })], ['C', normalizeGraph({ nodes: catalog, edges: [{ source: 'C', target: 'E', distance: 10 }] })]]);
  const view = neighborhoodView(root, .5, 'A', 20, null, catalog, branches);
  assert.deepEqual(view.edges.map(e => [e.source, e.target]), [['A', 'B'], ['B', 'C']]);
  assert.equal(view.nodes.find(n => n.id === 'C').missingComparison, false);
  assert.equal(view.nodes.find(n => n.id === 'E').missingComparison, true);
});

test('second-level languages use only their strongest parent and omit links between direct neighbors', () => {
  const catalog = ['A', 'B', 'C', 'D', 'E'].map(id => ({ id }));
  const root = normalizeGraph({ nodes: catalog.slice(0, 3), edges: [
    { source: 'A', target: 'B', distance: 10 }, { source: 'A', target: 'C', distance: 15 },
  ] });
  const branches = new Map([
    ['B', normalizeGraph({ nodes: catalog, edges: [
      { source: 'B', target: 'C', distance: 5 }, { source: 'B', target: 'D', distance: 40 },
      { source: 'B', target: 'E', distance: 20 },
    ] })],
    ['C', normalizeGraph({ nodes: catalog, edges: [
      { source: 'C', target: 'B', distance: 5 }, { source: 'D', target: 'C', distance: 10 },
      { source: 'C', target: 'E', distance: 20 },
    ] })],
  ]);
  const view = neighborhoodView(root, 0, 'A', 20, null, catalog, branches);
  assert.equal(view.nodes.find(n => n.id === 'D').parentId, 'C');
  assert.equal(view.nodes.find(n => n.id === 'E').parentId, 'B');
  assert.equal(view.edges.length, 4);
  for (const id of ['D', 'E']) {
    assert.equal(view.edges.filter(e => e.source === id || e.target === id).length, 1);
  }
  assert.ok(!view.edges.some(e => [e.source, e.target].sort().join('') === 'BC'));
});

test('five-level traversal assigns shortest hops, prevents cycles, and gives each deeper node one parent', () => {
  const catalog = ['A', 'B', 'C', 'D', 'E', 'F'].map(id => ({ id }));
  const edges = [
    { source: 'A', target: 'B', distance: 10 }, { source: 'B', target: 'C', distance: 10 },
    { source: 'C', target: 'D', distance: 10 }, { source: 'D', target: 'E', distance: 10 },
    { source: 'E', target: 'F', distance: 10 }, { source: 'B', target: 'D', distance: 30 },
  ];
  const branches = new Map(catalog.map(n => [n.id, normalizeGraph({ nodes: catalog, edges: edges.filter(e => e.source === n.id || e.target === n.id) })]));
  const view = neighborhoodView(branches.get('A'), 0, 'A', 20, null, catalog, branches, 5);
  assert.deepEqual(view.nodes.map(n => n.level), [0, 1, 2, 2, 3, 4]);
  assert.equal(view.edges.length, 5);
  for (const node of view.nodes.filter(n => n.level > 1)) {
    const parent = view.nodes.find(n => n.id === node.parentId);
    assert.equal(node.level, parent.level + 1);
    assert.equal(view.edges.filter(e => (e.source === node.id && e.target === parent.id) || (e.target === node.id && e.source === parent.id)).length, 1);
  }
});
