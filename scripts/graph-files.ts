import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite, type Language } from './lib.js';

export interface GraphEdge {
  source: string; target: string; distance: number;
  sourceUrl?: string; wordCount?: number; fetchedAt?: string;
}
export interface GraphData { nodes: Language[]; edges: GraphEdge[] }
export const graphFileName = (id: string) => `${createHash('sha256').update(id).digest('hex')}.json`;

// Each edge is indexed at both endpoints, so either language can become the center.
// Write only changed languages at importer checkpoints; publish the index last.
export async function writeGraphFiles(directory: string, graph: GraphData, changed?: ReadonlySet<string>) {
  const labels = new Map(graph.nodes.map(n => [n.id, n]));
  const incident = new Map(graph.nodes.map(n => [n.id, [] as GraphEdge[]]));
  for (const edge of graph.edges) {
    if (!labels.has(edge.source) || !labels.has(edge.target) || edge.source === edge.target ||
      !Number.isFinite(edge.distance) || edge.distance < 0 || edge.distance > 100) throw new Error('Invalid edge in graph export');
    const { source, target, distance, sourceUrl, wordCount, fetchedAt } = edge;
    const compact = { source, target, distance, similarity: Number((1 - distance / 100).toFixed(6)), sourceUrl, wordCount, fetchedAt };
    incident.get(source)!.push(compact); incident.get(target)!.push(compact);
  }
  const generatedAt = new Date().toISOString();
  for (const node of graph.nodes) {
    if (changed && !changed.has(node.id)) continue;
    const edges = incident.get(node.id)!;
    const ids = new Set([node.id]);
    for (const edge of edges) { ids.add(edge.source); ids.add(edge.target); }
    await atomicWrite(join(directory, 'languages', graphFileName(node.id)), JSON.stringify({
      schemaVersion: 1, generatedAt, center: node.id, directed: false,
      nodes: [...ids].map(id => labels.get(id)), edges,
    }) + '\n');
  }
  const index = {
    schemaVersion: 1, generatedAt, comparisonCount: graph.edges.length,
    languages: graph.nodes.map(n => ({ ...n, graphFile: `/graphs/${graphFileName(n.id)}` })),
  };
  await atomicWrite(join(directory, 'index.json'), JSON.stringify(index) + '\n');
  return index;
}

export async function splitGraphFile(dataDir: string) {
  const graph: GraphData = JSON.parse(await readFile(join(dataDir, 'graph.json'), 'utf8'));
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new Error('Invalid graph.json');
  return writeGraphFiles(join(dataDir, 'graph'), graph);
}

export async function ensureGraphFiles(dataDir: string) {
  try {
    const index = JSON.parse(await readFile(join(dataDir, 'graph/index.json'), 'utf8'));
    if (index.schemaVersion !== 1 || !Array.isArray(index.languages) || !index.languages.length ||
      index.languages.some((n: Language & { graphFile: string }) => !n.id || n.graphFile !== `/graphs/${graphFileName(n.id)}`)) {
      throw new Error('Invalid graph index. Run npm run graph:split to rebuild it.');
    }
    return index as { schemaVersion: number; generatedAt: string; comparisonCount: number;
      languages: (Language & { graphFile: string })[] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return splitGraphFile(dataDir);
  }
}
