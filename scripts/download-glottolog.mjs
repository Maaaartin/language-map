import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parse } from 'csv-parse/sync';

const SOURCE = 'https://raw.githubusercontent.com/glottolog/glottolog-cldf/master/cldf/languages.csv';
const DEFAULT_FILE = fileURLToPath(new URL('../data/glottolog/languages.csv', import.meta.url));
const { values } = parseArgs({ options: {
  output: { type: 'string', default: DEFAULT_FILE },
  url: { type: 'string', default: SOURCE },
  force: { type: 'boolean', default: false },
} });
const destination = resolve(values.output);
const metadataPath = `${destination}.source.json`;
const sha256 = text => createHash('sha256').update(text).digest('hex');

function validate(csv) {
  const records = parse(csv, { bom: true, skip_empty_lines: true, columns: headers => {
    for (const column of ['ID', 'Name', 'Glottocode', 'ISO639P3code', 'Level', 'Latitude', 'Longitude', 'Countries']) {
      if (!headers.includes(column)) throw new Error(`Missing Glottolog CSV column: ${column}`);
    }
    return headers;
  } });
  if (!records.length) throw new Error('Glottolog CSV is empty');
  return records.length;
}

async function atomicWrite(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, content); await rename(temporary, path); }
  finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

let cached = false;
if (!values.force) {
  try {
    const csv = await readFile(destination, 'utf8');
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    if (metadata.sourceUrl === values.url && metadata.sha256 === sha256(csv)) {
      const count = validate(csv);
      console.log(`Using cached Glottolog CSV: ${destination} (${count} records). Use --force to refresh.`);
      cached = true;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn(`Glottolog cache needs replacement: ${error.message}`);
  }
}
if (!cached) {
  let csv;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(values.url, { signal: AbortSignal.timeout(45_000),
        headers: { 'User-Agent': 'language-map-reference-import/1.0', Accept: 'text/csv,text/plain' } });
      if (!response.ok) {
        await response.body?.cancel();
        const error = new Error(`HTTP ${response.status} downloading Glottolog`);
        error.permanent = response.status >= 400 && response.status < 500 && response.status !== 429;
        throw error;
      }
      csv = await response.text();
      break;
    } catch (error) {
      if (error.permanent || attempt === 2) throw new Error(`Could not download Glottolog CSV: ${error.message}`, { cause: error });
      console.warn(`Glottolog download failed; retrying (${attempt + 1}/2)…`);
      await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }
  const rowCount = validate(csv);
  const metadata = { sourceUrl: values.url, sourceRepository: 'https://github.com/glottolog/glottolog-cldf',
    downloadedAt: new Date().toISOString(), sha256: sha256(csv), rowCount,
    license: 'CC-BY-4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/' };
  await atomicWrite(destination, csv);
  await atomicWrite(metadataPath, JSON.stringify(metadata, null, 2) + '\n');
  console.log(`Downloaded Glottolog CSV: ${destination} (${rowCount} records).`);
}
