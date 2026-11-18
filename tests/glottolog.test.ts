import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mapExactNames, parseGlottolog } from '../scripts/glottolog.js';

const header = 'ID,Name,Glottocode,ISO639P3code,Level,Latitude,Longitude,Countries';
const csv = `${header}\r\nabkh1244,Abkhaz,abkh1244,abk,language,43.056218,41.159115,GE;RU;TR\r\nzero1234,"Comma, \"\"Name\"\"",zero1234,,dialect,0,0,\r\nnone1234,No geography,none1234,,dialect,,,\r\nfamily12,Uzbek,family12,uzb,family,,,UZ\r\n`;

test('postinstall maps local sources, regenerates output, and fails when a source is missing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mapping-install-'));
  const source = JSON.stringify({ schemaVersion: 1, languages: [
    { id: 'Abkhaz', label: 'Abkhaz' }, { id: 'Unknown', label: 'Unknown' },
  ] });
  const csvFile = join(dir, 'glottolog/languages.csv');
  const run = () => promisify(execFile)(process.execPath, ['scripts/postinstall.mjs', '--data-dir', dir]);
  try {
    await mkdir(join(dir, 'glottolog'));
    await writeFile(csvFile, csv);
    await writeFile(join(dir, 'languages.json'), source);
    await run();
    const output = join(dir, 'languages-enriched.json');
    const result = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(result.summary.matched, 1);
    assert.equal(result.summary.unmatched, 1);
    assert.deepEqual(result.languages[0].glottolog.countries, ['GE', 'RU', 'TR']);
    await rm(output);
    await run();
    assert.equal(JSON.parse(await readFile(output, 'utf8')).summary.matched, 1);
    assert.equal(await readFile(csvFile, 'utf8'), csv);
    assert.equal(await readFile(join(dir, 'languages.json'), 'utf8'), source);
    await rm(csvFile);
    await assert.rejects(run(), /Missing .*languages.csv/);
    await writeFile(csvFile, csv);
    await rm(join(dir, 'languages.json'));
    await assert.rejects(run(), /ENOENT.*languages.json/);
    await writeFile(join(dir, 'languages.json'), '{invalid');
    await assert.rejects(run(), /map-languages.ts failed/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('CSV parses quoted names, zero coordinates, country lists, and missing geography without inheritance', () => {
  const records = parseGlottolog('\uFEFF' + csv);
  assert.deepEqual(records[0], { glottocode: 'abkh1244', name: 'Abkhaz', iso6393: 'abk', level: 'language', latitude: 43.056218, longitude: 41.159115, countries: ['GE', 'RU', 'TR'] });
  assert.equal(records[1].name, 'Comma, "Name"');
  assert.equal(records[1].latitude, 0); assert.equal(records[1].longitude, 0);
  assert.equal(records[1].iso6393, null); assert.deepEqual(records[1].countries, []);
  assert.equal(records[2].latitude, null); assert.equal(records[2].longitude, null);
  assert.equal(records[3].level, 'family');
  assert.throws(() => parseGlottolog('Name\nAbkhaz\n'), /header/);
  assert.throws(() => parseGlottolog(csv.replace('43.056218', '91')), /coordinate/);
});

test('matches labels exactly, preserving case, punctuation, spacing, and dialect qualifiers', () => {
  const labels = ['Abkhaz', 'abkhaz', ' Abkhaz', 'Abkhaz ', 'Abkház', 'Abkhaz_(Dialect)', 'No geography', 'Uzbek'];
  const result = mapExactNames(labels.map((label, i) => ({ id: `id${i}`, label })), parseGlottolog(csv));
  assert.deepEqual(result.matched.map(l => l.label), ['Abkhaz', 'No geography', 'Uzbek']);
  assert.equal(result.summary.unmatched, 5);
  assert.equal(result.summary.matchedWithoutCountries, 1);
  assert.equal(result.summary.matchedWithoutCoordinates, 2);
  assert.equal(result.matched[0].id, 'id0');
  const duplicate = { ...parseGlottolog(csv)[0], glottocode: 'othe1234' };
  const ambiguous = mapExactNames([{ id: 'A', label: 'Abkhaz' }], [...parseGlottolog(csv), duplicate]);
  assert.equal(ambiguous.summary.ambiguous, 1);
  assert.equal(ambiguous.unmatched[0].reason, 'multiple_exact_names');
  assert.deepEqual(ambiguous.unmatched[0].candidates, ['abkh1244', 'othe1234']);
});

test('mapper CLI writes enrichment and prints both groups while preserving source languages', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'language-mapping-'));
  const source = JSON.stringify({ schemaVersion: 1, languages: [{ id: 'Abkhaz', label: 'Abkhaz' }, { id: 'lowercase', label: 'abkhaz' }] });
  try {
    await writeFile(join(dir, 'languages.json'), source);
    await writeFile(join(dir, 'reference.csv'), csv);
    const run = (...extra: string[]) => promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/map-languages.ts', '--data-dir', dir, '--csv', join(dir, 'reference.csv'), ...extra]);
    const result = await run();
    assert.match(result.stdout, /MATCHED \(1\)/); assert.match(result.stdout, /UNMATCHED \(1\)/);
    assert.match(result.stdout, /Abkhaz \[Abkhaz\] -> abkh1244/);
    assert.match(result.stdout, /abkhaz \[lowercase\] -> no_exact_name/);
    const output = JSON.parse(await readFile(join(dir, 'languages-enriched.json'), 'utf8'));
    assert.equal(output.summary.matched, 1);
    assert.deepEqual(output.languages[0].glottolog.countries, ['GE', 'RU', 'TR']);
    assert.equal(output.languages[1].glottolog, null);
    assert.equal(await readFile(join(dir, 'languages.json'), 'utf8'), source);
    await assert.rejects(run('--output', join(dir, 'languages.json')), /Output must be separate/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('download script validates, caches, refreshes, and preserves a good CSV if a refresh fails', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'glottolog-download-'));
  const output = join(dir, 'reference.csv');
  let requests = 0, invalid = false;
  const server = createServer((_, res) => { requests++; res.end(invalid ? '<html>error</html>' : csv); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/languages.csv`;
  const run = (...extra: string[]) => promisify(execFile)(process.execPath, ['scripts/download-glottolog.mjs', '--url', url, '--output', output, ...extra]);
  try {
    await run(); assert.equal(requests, 1); assert.equal(await readFile(output, 'utf8'), csv);
    const metadata = JSON.parse(await readFile(`${output}.source.json`, 'utf8'));
    assert.equal(metadata.rowCount, 4); assert.equal(metadata.sourceUrl, url); assert.match(metadata.sha256, /^[a-f0-9]{64}$/);
    assert.match((await run()).stdout, /Using cached/); assert.equal(requests, 1);
    await run('--force'); assert.equal(requests, 2);
    invalid = true;
    await assert.rejects(run('--force'), /Missing Glottolog CSV column/);
    assert.equal(await readFile(output, 'utf8'), csv);
    assert.equal(requests, 3);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
