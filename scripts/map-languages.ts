import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { saveJson, type LanguageList } from './lib.js';
import { mapExactNames, parseGlottolog } from './glottolog.js';
import { parseClassification } from './classification.js';

const { values } = parseArgs({ options: {
  'data-dir': { type: 'string', default: 'data' },
  csv: { type: 'string', default: fileURLToPath(new URL('../data/glottolog/languages.csv', import.meta.url)) },
  output: { type: 'string' },
  summary: { type: 'boolean', default: false },
  classification: { type: 'string' },
} });
const languagesFile = resolve(join(values['data-dir'], 'languages.json'));
const csvFile = resolve(values.csv);
const output = resolve(values.output ?? join(values['data-dir'], 'languages-enriched.json'));
if (output === languagesFile || output === csvFile) throw new Error('Output must be separate from the source language list and CSV');
const list: LanguageList = JSON.parse(await readFile(languagesFile, 'utf8'));
if (!Array.isArray(list.languages) || !list.languages.length || list.languages.some(l => typeof l.id !== 'string' || !l.id || typeof l.label !== 'string' || !l.label) ||
  new Set(list.languages.map(l => l.id)).size !== list.languages.length) throw new Error('Invalid languages.json');
let csv: string;
try { csv = await readFile(csvFile, 'utf8'); }
catch (error) {
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`Missing ${csvFile}. Run npm run download:glottolog first.`);
  throw error;
}
const sha256 = createHash('sha256').update(csv).digest('hex');
let provenance = null;
try {
  provenance = JSON.parse(await readFile(`${csvFile}.source.json`, 'utf8'));
  if (provenance.sha256 !== sha256) throw new Error('Glottolog CSV does not match its download metadata. Run npm run download:glottolog -- --force.');
} catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
const classificationFile = resolve(values.classification ?? join(csvFile, '..', 'classification.nex'));
let treeSource: { file: string; sha256: string } | null = null;
let parents = new Map<string, string | null>();
try {
  const tree = await readFile(classificationFile, 'utf8');
  parents = parseClassification(tree);
  treeSource = { file: classificationFile, sha256: createHash('sha256').update(tree).digest('hex') };
} catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
const result = mapExactNames(list.languages, parseGlottolog(csv), parents);
await saveJson(output, {
  schemaVersion: 1, generatedAt: new Date().toISOString(),
  matchingRule: 'Exact case-sensitive language.label === Glottolog Name; no aliases, normalization, or inherited geography.',
  sources: { languagesFile, glottologCsv: csvFile, sha256, download: provenance, classification: treeSource },
  summary: result.summary, languages: result.languages,
});
if (!values.summary) {
  console.log(`\nMATCHED (${result.matched.length})`);
  for (const language of result.matched) {
    const g = language.glottolog;
    console.log(`  ${language.label} [${language.id}] -> ${g.glottocode}; ISO=${g.iso6393 ?? '—'}; level=${g.level}; lat=${g.latitude ?? '—'}; lon=${g.longitude ?? '—'}; countries=${g.countries.join(',') || '—'}`);
  }
  console.log(`\nUNMATCHED (${result.unmatched.length})`);
  for (const language of result.unmatched) {
    console.log(`  ${language.label} [${language.id}] -> ${language.reason}${language.candidates.length ? ` (${language.candidates.join(', ')})` : ''}`);
  }
}
console.log(`\n${result.summary.matched}/${result.summary.total} matched; ${result.summary.unmatched} unmatched (${result.summary.ambiguous} ambiguous).`);
console.log(`${result.summary.matchedWithoutCountries} matches have no countries; ${result.summary.matchedWithoutCoordinates} have incomplete coordinates.`);
console.log(`${result.matched.filter(l => l.classification.family).length} languages have a family; ${result.matched.filter(l => l.classification.branch).length} have a subgroup.`);
console.log(`Saved ${output}`);
