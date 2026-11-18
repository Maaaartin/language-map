import { parse } from 'csv-parse/sync';
import type { Language } from './lib.js';

export interface GlottologRecord {
  glottocode: string;
  name: string;
  level: 'language' | 'dialect' | 'family';
  iso6393: string | null;
  latitude: number | null;
  longitude: number | null;
  countries: string[];
  familyId?: string | null;
  isolate?: boolean;
  languageId?: string | null;
}
export interface FamilyReference { id: string; name: string }
export interface Classification {
  status: 'classified' | 'isolate' | 'unavailable';
  family: FamilyReference | null;
  branch: FamilyReference | null;
  ancestors: FamilyReference[];
}
export type MappedLanguage = Language & (
  { matchStatus: 'matched'; glottolog: GlottologRecord; classification: Classification } |
  { matchStatus: 'unmatched'; glottolog: null; classification: null; reason: 'no_exact_name' | 'multiple_exact_names'; candidates: string[] }
);

export function parseGlottolog(csv: string): GlottologRecord[] {
  const rows = parse(csv, { bom: true, skip_empty_lines: true, columns: (headers: string[]) => {
    const required = ['ID', 'Name', 'Glottocode', 'ISO639P3code', 'Level', 'Latitude', 'Longitude', 'Countries'];
    if (new Set(headers).size !== headers.length || required.some(c => !headers.includes(c))) throw new Error('Invalid Glottolog CSV header');
    return headers;
  } }) as Record<string, string>[];
  if (!rows.length) throw new Error('Glottolog CSV is empty');
  const coordinate = (value: string, bound: number, name: string): number | null => {
    if (value === '') return null;
    const n = Number(value);
    if (!value.trim() || !Number.isFinite(n) || n < -bound || n > bound) throw new Error(`Invalid coordinate for ${name}: ${value}`);
    return n;
  };
  const ids = new Set<string>();
  return rows.map(row => {
    const id = row.Glottocode || row.ID;
    if (!id || ids.has(id) || !row.Name || !['language', 'dialect', 'family'].includes(row.Level)) throw new Error(`Invalid or duplicate Glottolog record: ${id}`);
    ids.add(id);
    const countries = row.Countries ? row.Countries.split(';') : [];
    if (countries.some(c => !/^[A-Z]{2}$/.test(c))) throw new Error(`Invalid country code for ${row.Name}`);
    return { glottocode: id, name: row.Name, level: row.Level as GlottologRecord['level'],
      iso6393: row.ISO639P3code || null,
      latitude: coordinate(row.Latitude, 90, row.Name), longitude: coordinate(row.Longitude, 180, row.Name), countries,
      ...('Family_ID' in row ? { familyId: row.Family_ID || null } : {}),
      ...('Language_ID' in row ? { languageId: row.Language_ID || null } : {}),
      ...('Is_Isolate' in row ? { isolate: row.Is_Isolate === 'true' } : {}) };
  });
}

export function mapExactNames(languages: Language[], records: GlottologRecord[], parents = new Map<string, string | null>()) {
  const byId = new Map(records.map(r => [r.glottocode, r]));
  const mainBranches = new Set(['Germanic', 'Slavic', 'Romance', 'Celtic', 'Baltic', 'Indo-Iranian', 'Hellenic', 'Armenian', 'Albanian', 'Anatolian', 'Tocharian']);
  const classification = (record: GlottologRecord): Classification => {
    const ancestors: FamilyReference[] = [];
    const seen = new Set<string>();
    let id: string | null | undefined = record.glottocode;
    while (id && !seen.has(id)) {
      seen.add(id); const ancestor = byId.get(id);
      if (ancestor?.level === 'family') ancestors.unshift({ id, name: ancestor.name });
      id = parents.has(id) ? parents.get(id) : ancestor?.languageId;
    }
    const root = byId.get(record.familyId ?? '');
    if (root && !ancestors.some(a => a.id === root.glottocode)) ancestors.unshift({ id: root.glottocode, name: root.name });
    const family = ancestors[0] ?? null;
    const branch = ancestors.find(a => mainBranches.has(a.name)) ?? ancestors[1] ?? null;
    return { status: record.isolate ? 'isolate' : family ? 'classified' : 'unavailable', family, branch, ancestors };
  };
  const byName = new Map<string, GlottologRecord[]>();
  for (const record of records) {
    const matches = byName.get(record.name) ?? [];
    matches.push(record); byName.set(record.name, matches);
  }
  const mapped: MappedLanguage[] = languages.map(language => {
    const matches = byName.get(language.label) ?? [];
    if (matches.length === 1) return { ...language, matchStatus: 'matched', glottolog: matches[0], classification: classification(matches[0]) };
    return { ...language, matchStatus: 'unmatched', glottolog: null, classification: null,
      reason: matches.length ? 'multiple_exact_names' : 'no_exact_name', candidates: matches.map(r => r.glottocode) };
  });
  const matched = mapped.filter((l): l is Extract<MappedLanguage, { matchStatus: 'matched' }> => l.matchStatus === 'matched');
  const unmatched = mapped.filter((l): l is Extract<MappedLanguage, { matchStatus: 'unmatched' }> => l.matchStatus === 'unmatched');
  return { languages: mapped, matched, unmatched, summary: {
    total: languages.length, matched: matched.length, unmatched: unmatched.length,
    ambiguous: unmatched.filter(l => l.reason === 'multiple_exact_names').length,
    matchedWithoutCountries: matched.filter(l => !l.glottolog.countries.length).length,
    matchedWithoutCoordinates: matched.filter(l => l.glottolog.latitude === null || l.glottolog.longitude === null).length,
  } };
}
