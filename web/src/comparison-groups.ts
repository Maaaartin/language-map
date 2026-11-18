import type { GraphView, Grouping, LanguageNode } from './types.js';
import { languageGroup } from './family-groups.js';

// Group nodes are presentation only. Keep real comparisons in the source graph.
export function collapseComparisonGroups(view: GraphView, center: string, grouping: Grouping, expanded: Set<string>): GraphView {
  const groups = new Map<string, LanguageNode[]>();
  const representatives = new Map<string, string>();
  for (const node of view.nodes) {
    const group = languageGroup(node, grouping);
    if (node.id === center || group.key === 'unclassified' || expanded.has(group.key)) continue;
    if (!groups.has(group.key)) groups.set(group.key, []);
    groups.get(group.key)!.push(node);
    representatives.set(node.id, `group:${group.key}`);
  }
  const nodes: LanguageNode[] = view.nodes.filter(n => !representatives.has(n.id)).map(n => ({ ...n,
    parentId: n.parentId ? representatives.get(n.parentId) ?? n.parentId : undefined }));
  for (const [key, members] of groups) {
    const first = members[0];
    const classification = first.classification;
    const depths = members.flatMap(n => n.level == null ? [] : [n.level]);
    nodes.push({ id: `group:${key}`, label: (grouping === 'branch' ? classification?.branch?.name : null)
      ?? classification?.family?.name ?? languageGroup(first, grouping).label,
      classification, collapsedGroup: { key, count: members.length },
      level: depths.length ? Math.min(...depths) : null,
      missingComparison: members.every(n => n.missingComparison) });
  }
  // The strongest measured member determines a collapsed group's connection.
  const edges = new Map<string, GraphView['edges'][number]>();
  for (const edge of view.edges) {
    const source = representatives.get(edge.source) ?? edge.source;
    const target = representatives.get(edge.target) ?? edge.target;
    if (source === target) continue;
    const key = JSON.stringify([source, target].sort());
    if (!edges.has(key) || edges.get(key)!.similarity < edge.similarity) {
      edges.set(key, { ...edge, source, target });
    }
  }
  return { nodes, edges: [...edges.values()], total: view.total };
}
