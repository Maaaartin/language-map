// Glottolog's Nexus trees use Glottocodes as node labels and numeric lengths.
export function parseClassification(source: string): Map<string, string | null> {
  if (!/^\s*#NEXUS\b/i.test(source) || !/\bBEGIN\s+TREES\s*;/i.test(source) || !/\bEND\s*;/i.test(source)) throw new Error('Invalid Glottolog classification Nexus');
  const parents = new Map<string, string | null>();
  let trees = 0;
  for (const match of source.matchAll(/\btree\s+([a-z0-9]{8})\s*=\s*(?:\[&R\]\s*)?([^;]+);/gi)) {
    const text = match[2]; let position = 0;
    const space = () => { while (/\s/.test(text[position] ?? '') && position < text.length) position++; };
    const node = (depth = 0): string => {
      if (depth > 200) throw new Error('Classification tree too deep');
      space(); const children: string[] = [];
      if (text[position] === '(') {
        position++; children.push(node(depth + 1)); space();
        while (text[position] === ',') { position++; children.push(node(depth + 1)); space(); }
        if (text[position++] !== ')') throw new Error('Unbalanced classification tree');
      }
      space(); const label = text.slice(position).match(/^[a-z0-9]{8}/i)?.[0];
      if (!label || parents.has(label)) throw new Error(`Invalid or duplicate classification node: ${label}`);
      position += label.length; space();
      if (text[position] === ':') {
        position++;
        const length = text.slice(position).match(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i)?.[0];
        if (!length) throw new Error('Invalid classification branch length');
        position += length.length;
      }
      parents.set(label, null);
      for (const child of children) parents.set(child, label);
      return label;
    };
    const root = node(); space();
    if (root !== match[1] || position !== text.length) throw new Error('Invalid classification tree root or trailing data');
    trees++;
  }
  if (!trees || trees !== (source.match(/\btree\s+\S+\s*=/gi) ?? []).length) throw new Error('Missing or malformed classification trees');
  return parents;
}
