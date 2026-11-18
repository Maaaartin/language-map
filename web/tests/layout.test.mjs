import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forceSimulation, forceManyBody, forceX, forceY } from 'd3';
import { anchorSelection, viewportTransform, comparisonDistance, constrainConnectionLengths, placeDescendantNodes, arrangeBranchSectors } from '../dist/layout.js';
import { similarityWidth } from '../dist/edge-style.js';

test('rendered connection lengths decrease linearly with stroke width despite force displacement', () => {
  const anchor = { id: 'center', x: 400, y: 300, fx: 400, fy: 300 };
  const similarities = [0, .2, .5, .8, 1];
  const neighbors = similarities.map((similarity, i) => ({ id: `n${i}`, x: 900 + i, y: 500, similarity }));
  const edges = neighbors.map(n => ({ source: anchor, target: n, similarity: n.similarity }));
  constrainConnectionLengths([anchor, ...neighbors], edges, 'center');
  for (const n of neighbors) {
    const length = Math.hypot(n.x - anchor.x, n.y - anchor.y);
    assert.ok(Math.abs(length - comparisonDistance(n.similarity)) < 1e-9);
    assert.ok(Math.abs(length + (similarityWidth(n.similarity) - .8) * 360 / 8.2 - 430) < 1e-9);
  }
  assert.ok(Math.abs(comparisonDistance(1) - 70) < 1e-9);
  assert.equal(comparisonDistance(0), 430);
  assert.equal(comparisonDistance(NaN), 430);
  assert.deepEqual([anchor.x, anchor.y], [400, 300]);
});

test('selection stays pinned through simulation ticks, switching focus, and resize', () => {
  const nodes = [{ id: 'A', x: 20, y: 30 }, { id: 'B', x: 100, y: 200 }];
  const anchor = anchorSelection(nodes, 'A', 800, 600);
  assert.deepEqual([anchor.x, anchor.y, anchor.fx, anchor.fy], [400, 300, 400, 300]);
  const sim = forceSimulation(nodes).force('charge', forceManyBody())
    .force('x', forceX(400)).force('y', forceY(300)).stop();
  sim.tick(200);
  assert.deepEqual([anchor.x, anchor.y], [400, 300]);
  anchorSelection(nodes, 'B', 1000, 700);
  assert.equal(nodes[0].fx, null);
  assert.equal(nodes[0].fy, null);
  assert.deepEqual([nodes[1].fx, nodes[1].fy], [500, 350]);
  const camera = viewportTransform(nodes, nodes[1], 1000, 700);
  assert.equal(camera.x + camera.k * nodes[1].x, 500);
  assert.equal(camera.y + camera.k * nodes[1].y, 350);
  anchorSelection(nodes, null, 1000, 700);
  assert.ok(nodes.every(n => n.fx === null && n.fy === null));
});
test('asymmetric neighbors fit around the focused node without moving it off center', () => {
  const anchor = { x: 400, y: 300 };
  const nodes = [anchor, { x: 700, y: 500 }];
  const camera = viewportTransform(nodes, anchor, 800, 600);
  assert.equal(camera.x + camera.k * anchor.x, 400);
  assert.equal(camera.y + camera.k * anchor.y, 300);
  for (const n of nodes) {
    assert.ok(camera.x + camera.k * n.x >= 30 && camera.x + camera.k * n.x <= 770);
    assert.ok(camera.y + camera.k * n.y >= 65 && camera.y + camera.k * n.y <= 535);
  }
});

test('uncompared outer nodes do not shrink the focused neighborhood camera', () => {
  const anchor = { id: 'center', x: 400, y: 300 };
  const connected = [anchor, { id: 'neighbor', x: 650, y: 450 }];
  const outer = Array.from({ length: 412 }, (_, i) => ({
    id: `missing${i}`, missingComparison: true,
    x: 400 + 2100 * Math.cos(i), y: 300 + 2100 * Math.sin(i),
  }));
  const camera = viewportTransform([...connected, ...outer], anchor, 800, 600);
  assert.deepEqual(camera, viewportTransform(connected, anchor, 800, 600));
  assert.equal(camera.x + camera.k * anchor.x, 400);
  assert.equal(camera.y + camera.k * anchor.y, 300);
  assert.deepEqual(viewportTransform([anchor, ...outer], anchor, 800, 600),
    viewportTransform([anchor], anchor, 800, 600));
});

test('second-level siblings spread around their own parent with spacing and stable positions', () => {
  const center = { id: 'A', x: 400, y: 300 };
  const parent = { id: 'B', x: 600, y: 300 };
  const children = Array.from({ length: 20 }, (_, i) => ({
    id: `child${i}`, parentId: 'B', parentSimilarity: .9, x: 400, y: 300,
  }));
  const nodes = [center, parent, ...children];
  placeDescendantNodes(nodes, 'A');
  for (let i = 0; i < children.length; i++) {
    assert.ok(Math.hypot(children[i].x - parent.x, children[i].y - parent.y) > comparisonDistance(.9));
    for (let j = i + 1; j < children.length; j++) {
      assert.ok(Math.hypot(children[i].x - children[j].x, children[i].y - children[j].y) > 40);
    }
  }
  const before = children.map(n => [n.id, n.x, n.y]);
  placeDescendantNodes(nodes.reverse(), 'A');
  assert.deepEqual(children.map(n => [n.id, n.x, n.y]), before);
  assert.deepEqual([center.x, center.y, parent.x, parent.y], [400, 300, 600, 300]);
});

test('branch sectors avoid crossings between unrelated edges while preserving center distances', () => {
  const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  for (const count of [1, 2, 5, 20]) {
    const center = { id: 'center', x: 400, y: 300, fx: 400, fy: 300 };
    const nodes = [center], edges = [];
    for (let i = 0; i < count; i++) {
      const parent = { id: `parent${i}`, x: 400, y: 300 };
      nodes.push(parent);
      edges.push({ source: center, target: parent, similarity: (i % 5) / 4 });
      for (let j = 0; j < 1 + (i * 7 + 3) % 20; j++) {
        const child = { id: `child${i}-${j}`, parentId: parent.id, parentSimilarity: (j % 5) / 4, x: 400, y: 300 };
        nodes.push(child); edges.push({ source: parent, target: child, similarity: child.parentSimilarity });
      }
    }
    arrangeBranchSectors(nodes, edges, center.id);
    placeDescendantNodes(nodes, center.id);
    for (const edge of edges.filter(e => e.source === center)) {
      assert.ok(Math.abs(Math.hypot(edge.target.x - center.x, edge.target.y - center.y) - comparisonDistance(edge.similarity)) < 1e-9);
    }
    for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
      const a = edges[i], b = edges[j];
      if ([a.source, a.target].some(n => n === b.source || n === b.target)) continue;
      const intersects = cross(a.source, a.target, b.source) * cross(a.source, a.target, b.target) < -1e-8 &&
        cross(b.source, b.target, a.source) * cross(b.source, b.target, a.target) < -1e-8;
      assert.equal(intersects, false, `crossing: ${a.source.id}-${a.target.id} and ${b.source.id}-${b.target.id}`);
    }
    assert.deepEqual([center.x, center.y], [400, 300]);
  }
});

test('nested sectors keep a five-level tree free of unrelated edge crossings', () => {
  const center = { id: 'root', x: 400, y: 300 };
  const nodes = [center], edges = [];
  let frontier = [center];
  for (let depth = 1; depth <= 5; depth++) {
    const next = [];
    for (const parent of frontier) for (let i = 0; i < 2; i++) {
      const node = { id: `${parent.id}-${i}`, level: depth, x: 400, y: 300,
        ...(depth > 1 ? { parentId: parent.id, parentSimilarity: i ? .2 : .95 } : {}) };
      nodes.push(node); next.push(node);
      edges.push({ source: parent, target: node, similarity: i ? .2 : .95 });
    }
    frontier = next;
  }
  arrangeBranchSectors(nodes, edges, center.id);
  placeDescendantNodes(nodes, center.id);
  assert.ok(nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y)));
  const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
    const a = edges[i], b = edges[j];
    if ([a.source, a.target].some(n => n === b.source || n === b.target)) continue;
    const intersects = cross(a.source, a.target, b.source) * cross(a.source, a.target, b.target) < -1e-8 &&
      cross(b.source, b.target, a.source) * cross(b.source, b.target, a.target) < -1e-8;
    assert.equal(intersects, false, `crossing: ${a.target.id}, ${b.target.id}`);
  }
});
