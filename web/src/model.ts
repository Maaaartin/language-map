import type { GraphData, GraphEdge, GraphView, LanguageNode } from './types.js';
import { normalizeClassification } from './family-groups.js';

export function normalizeGraph(input: any): GraphData {
  if (!input || !Array.isArray(input.nodes) || !Array.isArray(input.edges)) throw new Error('Expected graph data with nodes and edges.');
  const ids = new Set();
  const nodes: LanguageNode[] = input.nodes.map((n: any): LanguageNode => {
    if (!n || typeof n.id !== 'string' || !n.id || ids.has(n.id)) throw new Error('Language IDs must be unique, non-empty strings.');
    ids.add(n.id);
    return { id: n.id, label: typeof n.label === 'string' ? n.label : n.id.replaceAll('_', ' '),
      ...('classification' in n ? { classification: normalizeClassification(n.classification) } : {}) };
  });
  if (!nodes.length) throw new Error('This graph has no languages.');
  const pairs = new Set();
  const edges: GraphEdge[] = input.edges.map((e: any): GraphEdge => {
    if (!e || !ids.has(e.source) || !ids.has(e.target) || e.source === e.target ||
      typeof e.distance !== 'number' || !Number.isFinite(e.distance) || e.distance < 0 || e.distance > 100) {
      throw new Error('Every edge needs known language IDs and a distance from 0 to 100.');
    }
    const key = JSON.stringify([e.source, e.target].sort());
    if (pairs.has(key)) throw new Error('Duplicate language comparison.');
    pairs.add(key);
    const url = typeof e.sourceUrl === 'string' && /^https?:\/\//i.test(e.sourceUrl) ? e.sourceUrl : null;
    return { source: e.source, target: e.target, distance: e.distance, similarity: 1 - e.distance / 100, sourceUrl: url };
  });
  edges.sort((a, b) => b.similarity - a.similarity);
  return { nodes, edges, expectedPairs: nodes.length * (nodes.length - 1) / 2 };
}
export function visibleEdges(graph: GraphData, threshold: number, max = 1500, selected: string | null = null) {
  const matches = graph.edges.filter(e => e.similarity + 1e-10 >= threshold &&
    (!selected || e.source === selected || e.target === selected));
  return { edges: matches.slice(0, max), total: matches.length };
}
export function comparisonBetween(graph: GraphData, first: string, second: string) {
  return graph.edges.find(e => (e.source === first && e.target === second) || (e.source === second && e.target === first));
}

export function defaultMinimumSimilarity(graph: GraphData, center: string, limit = 20) {
  const similarities = graph.edges.filter(e => e.source === center || e.target === center)
    .map(e => e.similarity).sort((a, b) => b - a);
  if (!similarities.length) return 100;
  // Round down to the slider's whole-percent step; the default view also caps
  // the ranked edges at 20 so ties and rounding cannot add extra neighbors.
  return Math.max(0, Math.floor(similarities[Math.min(limit, similarities.length) - 1] * 100 + 1e-8));
}
export function normalizeLanguageGraph(input: any, center: string, catalog: LanguageNode[]): GraphData {
  if (input.center !== center) throw new Error('Graph response does not match the selected language.');
  const graph = normalizeGraph(input);
  const known = new Set(catalog.map(n => n.id));
  const connected = new Set([center]);
  for (const edge of graph.edges) {
    if (edge.source !== center && edge.target !== center) throw new Error('Graph response contains unrelated comparisons.');
    connected.add(edge.source); connected.add(edge.target);
  }
  if (!graph.nodes.some(n => n.id === center) || graph.nodes.some(n => !known.has(n.id) || !connected.has(n.id))) {
    throw new Error('Graph response contains unrelated or unknown languages.');
  }
  return graph;
}
export function graphView(graph: GraphData, threshold: number, selected: string | null = null, max = 1500, compared: string | null = null, catalog: LanguageNode[] | null = null): GraphView {
  const visible = visibleEdges(graph, threshold, max, selected);
  if (!selected) return { ...visible, nodes: graph.nodes };
  const ids = new Set([selected]);
  if (compared) {
    ids.add(compared);
    const pair = comparisonBetween(graph, selected, compared);
    if (pair && !visible.edges.includes(pair)) {
      if (visible.edges.length >= max) visible.edges.pop();
      visible.edges.push(pair);
      visible.total = Math.max(visible.total, visible.edges.length);
    }
  }
  for (const edge of visible.edges) { ids.add(edge.source); ids.add(edge.target); }
  if (catalog) {
    const collected = new Set([selected]);
    for (const edge of graph.edges) {
      if (edge.source === selected) collected.add(edge.target);
      if (edge.target === selected) collected.add(edge.source);
    }
    // Missing data is distinct from a known comparison hidden by the filter.
    return { ...visible, nodes: catalog.filter(n => ids.has(n.id) || !collected.has(n.id))
      .map(n => ({ ...n, level: n.id === selected ? 0 : collected.has(n.id) ? 1 : null, missingComparison: !collected.has(n.id) })) };
  }
  return { ...visible, nodes: graph.nodes.filter(n => ids.has(n.id)) };
}

export function neighborhoodView(graph: GraphData, threshold: number, selected: string, max: number, compared: string | null, catalog: LanguageNode[], branches = new Map<string, GraphData>(), levels = 2): GraphView {
  const direct = graphView(graph, threshold, selected, max, compared, catalog);
  const edges = [...direct.edges];
  const depths = new Map([[selected, 0]]);
  const parents = new Map<string, { id: string; edge: GraphEdge }>();
  for (const edge of direct.edges) depths.set(edge.source === selected ? edge.target : edge.source, 1);
  let frontier = [...depths.keys()].filter(id => id !== selected);
  for (let depth = 2; depth <= levels && frontier.length && edges.length < 1500; depth++) {
    const candidates = new Map<string, { id: string; edge: GraphEdge }>();
    for (const id of frontier) {
      const branch = branches.get(id);
      if (!branch) continue;
      for (const edge of visibleEdges(branch, threshold, max, id).edges) {
        const child = edge.source === id ? edge.target : edge.source;
        // Breadth-first traversal keeps the nearest hop and one strongest parent.
        if (depths.has(child)) continue;
        const previous = candidates.get(child);
        if (!previous || edge.similarity > previous.edge.similarity ||
          (edge.similarity === previous.edge.similarity && id < previous.id)) {
          candidates.set(child, { id, edge });
        }
      }
    }
    const assigned = [...candidates].sort((a, b) => b[1].edge.similarity - a[1].edge.similarity || a[0].localeCompare(b[0]))
      .slice(0, Math.max(0, 1500 - edges.length));
    frontier = [];
    for (const [child, parent] of assigned) {
      depths.set(child, depth); parents.set(child, parent);
      edges.push(parent.edge); frontier.push(child);
    }
  }
  const visibleIds = new Set(direct.nodes.map(n => n.id));
  const missing = new Set(direct.nodes.filter(n => n.missingComparison).map(n => n.id));
  return { edges, total: edges.length, nodes: catalog.filter(n => visibleIds.has(n.id) || depths.has(n.id))
    .map(n => ({ ...n, level: depths.get(n.id) ?? null, parentId: parents.get(n.id)?.id,
      parentSimilarity: parents.get(n.id)?.edge.similarity,
      missingComparison: !depths.has(n.id) && missing.has(n.id) })) };
}
