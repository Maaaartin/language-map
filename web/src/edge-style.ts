// Base stroke widths shared by Leaflet polylines and graph SVG edges.
// The curve makes close matches stand out while keeping weak matches visible.
export function similarityWidth(similarity: number) {
  const value = Number.isFinite(similarity) ? Math.max(0, Math.min(1, similarity)) : 0;
  return 0.8 + 8.2 * value ** 1.7;
}
