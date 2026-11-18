import type { Grouping } from './types.js';
interface UrlState { center: string | null; compare: string | null; similarity: number | null; levels: number; grouping: Grouping; groupLanguages: boolean }
export function readUrlState(href: string, languageIds: string[]): UrlState {
  const url = new URL(href);
  const valid = new Set(languageIds);
  const language = url.searchParams.get('language');
  const center = language !== null && valid.has(language) ? language : null;
  const comparison = url.searchParams.get('compare');
  const compare = center && comparison !== null && valid.has(comparison) && comparison !== center ? comparison : null;
  const raw = url.searchParams.get('similarity');
  const value = raw !== null && raw.trim() !== '' ? Number(raw) : NaN;
  const similarity = Number.isFinite(value) && value >= 0 && value <= 100 ? Math.round(value) : null;
  const depth = Number(url.searchParams.get('levels'));
  const levels = Number.isInteger(depth) && depth >= 1 && depth <= 5 ? depth : 1;
  const grouping = url.searchParams.get('grouping') === 'family' ? 'family' : 'branch';
  return { center, compare, similarity, levels, grouping, groupLanguages: url.searchParams.get('groupLanguages') === 'true' };
}

export function writeUrlState(href: string, { center, compare, similarity, levels = 1, grouping = 'branch', groupLanguages = false }: Pick<UrlState, 'center' | 'similarity'> & Partial<Pick<UrlState, 'compare' | 'levels' | 'grouping' | 'groupLanguages'>>) {
  const url = new URL(href);
  url.searchParams.delete('language'); url.searchParams.delete('compare'); url.searchParams.delete('similarity');
  if (center) url.searchParams.set('language', center);
  if (center && compare && center !== compare) url.searchParams.set('compare', compare);
  if (similarity != null) url.searchParams.set('similarity', String(similarity));
  url.searchParams.delete('displayAll');
  url.searchParams.delete('levels');
  if (Number.isInteger(levels) && levels >= 2 && levels <= 5) url.searchParams.set('levels', String(levels));
  url.searchParams.delete('grouping');
  if (grouping === 'family') url.searchParams.set('grouping', grouping);
  url.searchParams.delete('groupLanguages');
  if (groupLanguages) url.searchParams.set('groupLanguages', 'true');
  return url.href;
}
