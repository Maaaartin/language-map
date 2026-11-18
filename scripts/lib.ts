import { load } from 'cheerio';
import { mkdir, writeFile, rename, readdir, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';

export const BASE_URL = 'http://elinguistics.net/Compare_Languages.aspx';
export interface Language { id: string; label: string }
export interface LanguageList {
  schemaVersion: 1; sourceUrl: string; fetchedAt: string; languages: Language[];
}
export interface Comparison {
  schemaVersion: 1; source: string; target: string; sourceUrl: string; fetchedAt: string;
  distance: number; similarity: number; wordCount: number; totalPoints: number;
  meanPoints: number; relationship: string | null;
  statistics: { expectation: number | null; standardDeviation: number | null; pValue: number | null };
  words: { concept: string; source: { consonants: string; text: string };
    target: { consonants: string; text: string }; comments: string; points: number }[];
  references: string;
  referenceLinks: { label: string; url: string }[];
}
export const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const numeric = (s: string) => {
  const n = Number(s.trim().replace(',', '.'));
  if (!s.trim() || !Number.isFinite(n)) throw new Error(`Invalid number: ${s}`);
  return n;
};
export function parseLanguages(html: string): Language[] {
  const $ = load(html);
  const read = (id: string) => $(id).find('option').toArray().map(el => ({
    id: ($(el).attr('value') ?? '').trim(), label: clean($(el).text()).replaceAll('_', ' '),
  })).filter(l => l.id && l.label);
  const first = read('#LanguageList1');
  const second = read('#LanguageList2');
  if (!first.length || !second.length) throw new Error('Language selectors missing or empty');
  const ids = new Set(first.map(l => l.id));
  if (ids.size !== first.length || ids.size !== second.length || second.some(l => !ids.has(l.id))) {
    throw new Error('Language selectors disagree or contain duplicate IDs');
  }
  return first;
}
export function comparisonUrl(source: string, target: string, base = BASE_URL): string {
  const url = new URL(base);
  url.search = new URLSearchParams({ Language1: source, Language2: target, Order: 'Details' }).toString();
  return url.href;
}
export function parseComparison(html: string, source: string, target: string, sourceUrl: string,
  fetchedAt = new Date().toISOString()): Comparison {
  const $ = load(html);
  const details = $('#lblDetails');
  const text = clean(details.text());
  const heading = clean($('#lblHeadResults').text());
  if (heading !== `Comparison ${source} to ${target}`) throw new Error(`Unexpected comparison heading: ${heading}`);
  const distanceMatch = text.match(/Distance:\s*(\d+(?:[.,]\d+)?)/i);
  const totals = text.match(/Total Points\/#words:\s*([\d.,]+)\s*\/\s*(\d+)\s*\(=\s*([\d.,]+)\/100\)/i);
  if (!distanceMatch || !totals) throw new Error('Comparison distance or totals missing');
  const distance = numeric(distanceMatch[1]);
  if (distance < 0 || distance > 100) throw new Error(`Distance out of range: ${distance}`);
  const words: Comparison['words'] = [];
  details.find('td.WordResultFirst').each((_, el) => {
    const cells = $(el).parent().children('td');
    if (cells.length !== 5) throw new Error('Unexpected word table columns');
    const word = (i: number) => {
      const cell = cells.eq(i).clone();
      const consonants = clean(cell.find('b').first().text());
      cell.find('b').first().remove();
      cell.find('br').replaceWith(' ');
      return { consonants, text: clean(cell.text()) };
    };
    const comments = cells.eq(3).clone();
    comments.find('br').replaceWith(' ');
    const points = numeric(cells.eq(4).text());
    if (points < 0 || points > 100) throw new Error(`Word points out of range: ${points}`);
    words.push({ concept: clean(cells.eq(0).text()), source: word(1), target: word(2),
      comments: clean(comments.text()), points });
  });
  const wordCount = numeric(totals[2]);
  if (!words.length || words.length !== wordCount) throw new Error(`Word count mismatch: ${words.length}/${wordCount}`);
  const optional = (pattern: RegExp) => { const m = text.match(pattern); return m ? numeric(m[1]) : null; };
  const referencesCell = details.find('td').filter((_, el) =>
    $(el).children('b').first().text().trim() === 'References:').last();
  const ref = referencesCell.clone();
  ref.find('br').replaceWith('\n');
  return {
    schemaVersion: 1, source, target, sourceUrl, fetchedAt, distance,
    similarity: Number((1 - distance / 100).toFixed(6)),
    wordCount, totalPoints: numeric(totals[1]), meanPoints: numeric(totals[3]),
    relationship: text.match(/These languages are\s+([^!]+)!/i)?.[1]?.trim() ?? null,
    statistics: {
      expectation: optional(/Mathematical expectation\s*\([^)]*\)\s*:\s*([\d.,]+)/i),
      standardDeviation: optional(/Standard deviation\s*\([^)]*\)\s*:\s*([\d.,]+)/i),
      pValue: optional(/p\s*-\s*value\s*=[^(]*\([^)]*\)\s*:\s*([\d.,]+(?:e[+-]?\d+)?)/i),
    }, words, references: ref.text().trim(),
    referenceLinks: referencesCell.find('a[href]').toArray().map(el => ({
      label: clean($(el).text()), url: new URL($(el).attr('href')!, sourceUrl).href,
    })),
  };
}

export async function atomicWrite(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, content);
  await rename(temporary, path);
}
export const saveJson = (path: string, value: unknown) => atomicWrite(path, JSON.stringify(value, null, 2) + '\n');
export async function removeRawHtml(dataDir: string): Promise<number> {
  const directory = join(dataDir, 'raw');
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.html')) continue;
    await unlink(join(directory, entry.name)); removed++;
  }
  return removed;
}
export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export function options(extra: Record<string, { type: 'string' | 'boolean'; default?: string | boolean }> = {}): Record<string, string | boolean | undefined> {
  return parseArgs({ options: {
    'data-dir': { type: 'string', default: 'data' },
    'base-url': { type: 'string', default: BASE_URL },
    'delay-ms': { type: 'string', default: '1000' },
    ...extra,
  } }).values;
}
export function integer(value: unknown, name: string, min = 0): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min) throw new Error(`${name} must be an integer >= ${min}`);
  return n;
}

// Shared start-rate limiter, including retries, across all queue workers.
// Timeout covers reading the body too.
export class Client {
  private lastRequest = 0;
  private cooldownUntil = 0;
  private turn = Promise.resolve();
  constructor(private delayMs: number) {}
  private async waitForTurn() {
    const previous = this.turn;
    let release!: () => void;
    this.turn = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      for (;;) {
        const wait = Math.max(this.lastRequest + this.delayMs, this.cooldownUntil) - Date.now();
        if (wait <= 0) break;
        await sleep(wait);
      }
      this.lastRequest = Date.now();
    } finally { release(); }
  }
  async get(url: string): Promise<string> {
    for (let attempt = 0; ; attempt++) {
      await this.waitForTurn();
      let retryAfter = 0;
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(30_000),
          headers: { 'User-Agent': 'language-map-scraper/1.0', Accept: 'text/html' },
        });
        if (!response.ok) {
          const header = response.headers.get('retry-after');
          if (header) retryAfter = /^\d+$/.test(header) ? Number(header) * 1000 : Math.max(0, Date.parse(header) - Date.now()) || 0;
          this.cooldownUntil = Math.max(this.cooldownUntil, Date.now() + retryAfter);
          await response.body?.cancel();
          if (response.status !== 429 && response.status < 500) throw new PermanentHttpError(`HTTP ${response.status}: ${url}`);
          throw new Error(`HTTP ${response.status}: ${url}`);
        }
        return await response.text();
      } catch (error) {
        if (error instanceof PermanentHttpError || attempt >= 3) throw error;
        const wait = Math.max(retryAfter, 1000 * 2 ** attempt);
        console.warn(`Request failed; retry ${attempt + 1}/3 in ${wait}ms: ${String(error)}`);
        await sleep(wait);
      }
    }
  }
}
class PermanentHttpError extends Error {}
