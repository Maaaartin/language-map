import type { GraphData, LocationRecord, LocationGroup, LocationConnection, ClosestResult } from './types.js';
import { normalizeClassification } from './family-groups.js';
export function prepareLocations(input: any) {
  if (!input || !Array.isArray(input.languages)) throw new Error('Expected enriched JSON with a languages array.');
  const records: LocationRecord[] = [], seen = new Set<string>();
  for (const row of input.languages) {
    if (!row || typeof row.id !== 'string' || !row.id || seen.has(row.id)) continue;
    seen.add(row.id);
    const g = row.glottolog;
    if (row.matchStatus !== 'matched' || !g || typeof g.latitude !== 'number' || !Number.isFinite(g.latitude) || Math.abs(g.latitude) > 90 ||
      typeof g.longitude !== 'number' || !Number.isFinite(g.longitude) || Math.abs(g.longitude) > 180) continue;
    records.push({ classification: normalizeClassification(row.classification), id: row.id, label: typeof row.label === 'string' ? row.label : row.id,
      name: typeof g.name === 'string' ? g.name : row.id, latitude: g.latitude, longitude: g.longitude,
      countries: Array.isArray(g.countries) ? g.countries.filter((c: unknown) => typeof c === 'string' && /^[A-Z]{2}$/.test(c)) : [],
      iso6393: typeof g.iso6393 === 'string' ? g.iso6393 : null,
      glottocode: typeof g.glottocode === 'string' ? g.glottocode : null,
      level: ['language', 'dialect', 'family'].includes(g.level) ? g.level : 'language' });
  }
  records.sort((a, b) => a.label.localeCompare(b.label));
  return { records, total: input.languages.length, withoutLocation: input.languages.length - records.length };
}
export function groupLocations(records: LocationRecord[]): LocationGroup[] {
  const groups = new Map<string, LocationGroup>();
  for (const record of records) {
    const key = JSON.stringify([record.latitude, record.longitude]);
    if (!groups.has(key)) groups.set(key, { latitude: record.latitude, longitude: record.longitude, records: [] });
    groups.get(key)!.records.push(record);
  }
  return [...groups.values()];
}
export function closestMappedLanguages(graph: GraphData, records: LocationRecord[], center: string, limit = 10): ClosestResult {
  const locations = new Map(records.map(r => [r.id, r]));
  const source = locations.get(center);
  if (!source) return { connections: [], withoutLocation: graph.edges.length, totalMapped: 0 };
  const connections: LocationConnection[] = [];
  let withoutLocation = 0;
  for (const edge of graph.edges) {
    if (edge.source !== center && edge.target !== center) continue;
    const target = locations.get(edge.source === center ? edge.target : edge.source);
    if (!target) { withoutLocation++; continue; }
    connections.push({ source, target, similarity: edge.similarity, distance: edge.distance, sourceUrl: edge.sourceUrl });
  }
  connections.sort((a, b) => b.similarity - a.similarity || a.target.label.localeCompare(b.target.label));
  return { connections: connections.slice(0, limit), withoutLocation, totalMapped: connections.length };
}
