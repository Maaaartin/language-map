import type { Classification, FamilyReference, Grouping, LanguageNode } from './types.js';
export function normalizeClassification(input: any): Classification | null {
  if (!input || !['classified', 'isolate', 'unavailable'].includes(input.status)) return null;
  const reference = (value: any): FamilyReference | null => value && typeof value.id === 'string' && typeof value.name === 'string'
    ? { id: value.id, name: value.name } : null;
  return { status: input.status, family: reference(input.family), branch: reference(input.branch),
    ancestors: Array.isArray(input.ancestors) ? input.ancestors.map(reference).filter((value: FamilyReference | null): value is FamilyReference => value !== null) : [] };
}

export function languageGroup(language: Pick<LanguageNode, 'classification'>, grouping: Grouping = 'branch') {
  const classification = normalizeClassification(language.classification);
  if (classification?.status === 'isolate') return { key: 'isolate', label: 'Language isolates' };
  const family = classification?.family;
  if (!family) return { key: 'unclassified', label: 'Unclassified' };
  const branch = grouping === 'branch' ? classification.branch : null;
  return { key: `${family.id}/${branch?.id ?? ''}`, label: branch && branch.id !== family.id ? `${family.name} / ${branch.name}` : family.name };
}

export function groupColor(key: string) {
  if (key === 'unclassified') return '#84939d';
  let hash = 0;
  for (const character of key) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360}, 40%, 65%)`;
}

export function languageSearchText(language: Pick<LanguageNode, 'id' | 'label' | 'classification'>) {
  return [language.id, language.label, ...(language.classification?.ancestors ?? []).map(a => a.name)]
    .join(' ').toLocaleLowerCase();
}
