// Distinct silhouettes for successive neighbor levels; level 1 uses SVG circles.
export function neighborShape(level: number, radius: number) {
  if (level === 4) return `M${-radius},${-radius}L${radius},${-radius}L${radius},${radius}L${-radius},${radius}Z`;
  const sides = level === 2 ? 4 : level === 3 ? 3 : 6;
  return Array.from({ length: sides }, (_, i) => {
    const angle = -Math.PI / 2 + i * 2 * Math.PI / sides;
    return `${i ? 'L' : 'M'}${Math.cos(angle) * radius},${Math.sin(angle) * radius}`;
  }).join('') + 'Z';
}
