import type { SimulationNodeDatum } from 'd3';

export type Grouping = 'family' | 'branch';
export interface FamilyReference { id: string; name: string }
export interface Classification {
  status: 'classified' | 'isolate' | 'unavailable';
  family: FamilyReference | null;
  branch: FamilyReference | null;
  ancestors: FamilyReference[];
}
export interface LanguageNode {
  id: string;
  label: string;
  classification?: Classification | null;
  level?: number | null;
  parentId?: string;
  parentSimilarity?: number;
  missingComparison?: boolean;
  groupKey?: string;
  collapsedGroup?: { key: string; count: number };
}
export interface GraphEdge {
  source: string;
  target: string;
  distance: number;
  similarity: number;
  sourceUrl: string | null;
}
export interface GraphData { nodes: LanguageNode[]; edges: GraphEdge[]; expectedPairs?: number }
export interface GraphView { nodes: LanguageNode[]; edges: GraphEdge[]; total: number }
export interface LayoutNode extends LanguageNode, SimulationNodeDatum {
  x: number;
  y: number;
  radius: number;
  color: string;
  branchSpread?: number;
}
export interface LayoutEdge extends Omit<GraphEdge, 'source' | 'target'> {
  source: string | LayoutNode;
  target: string | LayoutNode;
}
export interface RenderEdge extends Omit<GraphEdge, 'source' | 'target'> {
  source: LayoutNode;
  target: LayoutNode;
}
export interface LanguageCatalog {
  languages: (LanguageNode & { graphFile: string })[];
  comparisonCount?: number;
  schemaVersion?: number;
}
export interface LocationRecord extends Pick<LanguageNode, 'id' | 'label' | 'classification'> {
  name: string;
  latitude: number;
  longitude: number;
  countries: string[];
  iso6393: string | null;
  glottocode: string | null;
  level: 'language' | 'dialect' | 'family';
}
export interface LocationGroup { latitude: number; longitude: number; records: LocationRecord[] }
export interface LocationConnection {
  source: LocationRecord;
  target: LocationRecord;
  similarity: number;
  distance: number;
  sourceUrl: string | null;
}
export interface ClosestResult { connections: LocationConnection[]; withoutLocation: number; totalMapped: number }
