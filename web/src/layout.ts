import type { LayoutNode, LayoutEdge } from './types.js';
import { similarityWidth } from './edge-style.js';

// The widest edge is 70 units long; the thinnest is 430 units long.
// Use the same width scale so length and width have a linear inverse relationship.
export const comparisonDistance = (similarity: number) => 430 - (similarityWidth(similarity) - 0.8) * (360 / 8.2);

export function constrainConnectionLengths(nodes: LayoutNode[], edges: LayoutEdge[], selected: string | null) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const anchor = selected ? byId.get(selected) : undefined;
  if (!anchor) return;
  for (const edge of edges) {
    const source = typeof edge.source === 'string' ? edge.source : edge.source.id;
    const target = typeof edge.target === 'string' ? edge.target : edge.target.id;
    const neighbor = byId.get(source === selected ? target : target === selected ? source : '');
    // Let the user drag freely; restore the similarity radius after release.
    if (!neighbor || neighbor.fx != null || neighbor.fy != null) continue;
    const angle = Math.atan2(neighbor.y - anchor.y, neighbor.x - anchor.x);
    const radius = comparisonDistance(edge.similarity);
    neighbor.x = anchor.x + Math.cos(angle) * radius;
    neighbor.y = anchor.y + Math.sin(angle) * radius;
  }
}

export function placeUncomparedNodes(nodes: LayoutNode[], selected: string | null) {
  const anchor = nodes.find(n => n.id === selected);
  if (!anchor) return;
  const outer = nodes.filter(n => n.missingComparison).sort((a, b) => a.id.localeCompare(b.id));
  const neighborhoodRadius = Math.max(0, ...nodes.filter(n => !n.missingComparison)
    .map(n => Math.hypot(n.x - anchor.x, n.y - anchor.y)));
  const radius = Math.max(550, neighborhoodRadius + 120, outer.length * 32 / (2 * Math.PI));
  outer.forEach((node, i) => {
    if (node.fx != null || node.fy != null) return;
    const angle = -Math.PI / 2 + i * 2 * Math.PI / outer.length;
    node.x = anchor.x + Math.cos(angle) * radius;
    node.y = anchor.y + Math.sin(angle) * radius;
    node.vx = 0; node.vy = 0;
  });
}

function descendantWeights(nodes: LayoutNode[]) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const weights = new Map(nodes.map(node => [node.id, 1]));
  for (const node of nodes) {
    const seen = new Set([node.id]);
    let parent = byId.get(node.parentId ?? '');
    while (parent && !seen.has(parent.id)) {
      seen.add(parent.id); weights.set(parent.id, weights.get(parent.id)! + 1);
      parent = byId.get(parent.parentId ?? '');
    }
  }
  return weights;
}

export function arrangeBranchSectors(nodes: LayoutNode[], edges: LayoutEdge[], selected: string | null) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const anchor = selected ? byId.get(selected) : undefined;
  if (!anchor) return;
  const branches = new Map<string, { node: LayoutNode; similarity: number; weight: number }>();
  for (const edge of edges) {
    const source = typeof edge.source === 'string' ? edge.source : edge.source.id;
    const target = typeof edge.target === 'string' ? edge.target : edge.target.id;
    const id = source === selected ? target : target === selected ? source : null;
    if (id && byId.has(id)) branches.set(id, { node: byId.get(id)!, similarity: edge.similarity, weight: 1 });
  }
  const weights = descendantWeights(nodes);
  for (const branch of branches.values()) branch.weight = weights.get(branch.node.id)!;
  const ordered = [...branches.values()].sort((a, b) => (a.node.groupKey ?? '').localeCompare(b.node.groupKey ?? '') || a.node.id.localeCompare(b.node.id));
  const total = ordered.reduce((sum, branch) => sum + branch.weight, 0);
  let start = -Math.PI / 2;
  for (const { node, similarity, weight } of ordered) {
    const sector = 2 * Math.PI * weight / total;
    const angle = start + sector / 2;
    node.branchSpread = Math.min(Math.PI * .9, sector * .8);
    if (node.fx == null && node.fy == null) {
      const radius = comparisonDistance(similarity);
      node.x = anchor.x + Math.cos(angle) * radius;
      node.y = anchor.y + Math.sin(angle) * radius;
      node.vx = 0; node.vy = 0;
    }
    start += sector;
  }
}

export function placeDescendantNodes(nodes: LayoutNode[], selected: string | null) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const anchor = selected ? byId.get(selected) : undefined;
  if (!anchor) return;
  const families = new Map<string, LayoutNode[]>();
  for (const node of nodes) {
    if (!node.parentId || !byId.has(node.parentId)) continue;
    if (!families.has(node.parentId)) families.set(node.parentId, []);
    families.get(node.parentId)!.push(node);
  }
  const weights = descendantWeights(nodes);
  const visited = new Set();
  const placeFamily = (parent: LayoutNode): void => {
    if (visited.has(parent.id)) return;
    visited.add(parent.id);
    const children = families.get(parent.id);
    if (!children) return;
    const origin = byId.get(parent.parentId ?? '') ?? anchor;
    const outward = Math.atan2(parent.y - origin.y, parent.x - origin.x);
    children.sort((a, b) => a.id.localeCompare(b.id));
    // Recursively partition convex sectors: each subtree remains in its parent's
    // sector and all of its edges point away from the incoming stem.
    const spread = parent.branchSpread ?? Math.PI * .9;
    const total = children.reduce((sum, child) => sum + weights.get(child.id)!, 0);
    const minSlot = Math.min(...children.map(child => spread * weights.get(child.id)! / total));
    const spacing = children.length > 1 ? Math.max(0, 48 / minSlot - 70) : 0;
    let start = outward - spread / 2;
    for (const child of children) {
      const slot = spread * weights.get(child.id)! / total;
      const angle = start + slot / 2;
      child.branchSpread = slot * .8;
      if (child.fx == null && child.fy == null) {
        const radius = comparisonDistance(child.parentSimilarity ?? 0) + spacing;
        child.x = parent.x + Math.cos(angle) * radius;
        child.y = parent.y + Math.sin(angle) * radius;
        child.vx = 0; child.vy = 0;
      }
      placeFamily(child);
      start += slot;
    }
  };
  for (const id of families.keys()) {
    const parent = byId.get(id)!;
    if (!parent.parentId) placeFamily(parent);
  }
}

// Translate the existing layout together, then pin only the focused language.
export function anchorSelection(nodes: LayoutNode[], selected: string | null, width: number, height: number) {
  const anchor = nodes.find(n => n.id === selected);
  const cx = width / 2, cy = height / 2;
  const dx = anchor && Number.isFinite(anchor.x) ? cx - anchor.x : 0;
  const dy = anchor && Number.isFinite(anchor.y) ? cy - anchor.y : 0;
  for (const node of nodes) {
    if (Number.isFinite(node.x)) node.x += dx;
    if (Number.isFinite(node.y)) node.y += dy;
    node.fx = null; node.fy = null;
  }
  if (anchor) Object.assign(anchor, { x: cx, y: cy, fx: cx, fy: cy, vx: 0, vy: 0 });
  return anchor;
}

export function viewportTransform(nodes: LayoutNode[], anchor: LayoutNode | undefined, width: number, height: number) {
  // Missing comparisons live in a potentially large outer ring. Fit the measured
  // neighborhood so incomplete scrape coverage does not shrink the initial view.
  const positioned = nodes.filter(n => (!anchor || !n.missingComparison) && Number.isFinite(n.x) && Number.isFinite(n.y));
  if (!positioned.length) return null;
  const xs = positioned.map(n => n.x), ys = positioned.map(n => n.y);
  const x0 = Math.min(...xs) - 75, x1 = Math.max(...xs) + 75;
  const y0 = Math.min(...ys) - 65, y1 = Math.max(...ys) + 65;
  const cx = anchor?.x ?? (x0 + x1) / 2, cy = anchor?.y ?? (y0 + y1) / 2;
  // Symmetric bounds around the selection keep it at the exact viewport center.
  const spanX = 2 * Math.max(cx - x0, x1 - cx);
  const spanY = 2 * Math.max(cy - y0, y1 - cy);
  const k = Math.max(.03, Math.min(1.4, Math.max(1, width - 60) / spanX, Math.max(1, height - 170) / spanY));
  return { x: width / 2 - k * cx, y: height / 2 - k * cy, k };
}
