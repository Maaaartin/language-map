import { readFile, appendFile, mkdir, readdir, stat, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Client, comparisonUrl, integer, options, parseComparison, saveJson, atomicWrite,
  removeRawHtml, type Comparison, type LanguageList } from './lib.js';
import { runQueue, type QueueProgress } from './queue.js';
import { chooseImportMode, latestComparison, ImportCancelled, type SavedComparison } from './import-menu.js';
import { writeGraphFiles } from './graph-files.js';

const args = options({
  languages: { type: 'string' }, limit: { type: 'string' },
  mode: { type: 'string' },
  concurrency: { type: 'string', default: '1' },
  'checkpoint-every': { type: 'string', default: '25' },
  'queue-only': { type: 'boolean', default: false },
  'dry-run': { type: 'boolean', default: false },
  'export-only': { type: 'boolean', default: false },
});
const dir = String(args['data-dir']);
const list: LanguageList = JSON.parse(await readFile(join(dir, 'languages.json'), 'utf8'));
if (list.schemaVersion !== 1 || !Array.isArray(list.languages) || !list.languages.length ||
  list.languages.some(l => !l.id || !l.label) || new Set(list.languages.map(l => l.id)).size !== list.languages.length) {
  throw new Error('Invalid languages.json; run npm run languages first');
}
const selection = args.languages === undefined ? null : String(args.languages).split(',').map(s => s.trim());
for (const id of selection ?? []) {
  if (!list.languages.some(l => l.id === id)) throw new Error(`Unknown language ID: ${id}`);
}
const languages = list.languages.filter(l => !selection || selection.includes(l.id))
  .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
if (languages.length < 2) throw new Error('Select at least two languages');
const pairCount = languages.length * (languages.length - 1) / 2;
const delay = integer(args['delay-ms'], 'delay-ms');
const limit = args.limit === undefined ? Infinity : integer(args.limit, 'limit');
const concurrency = integer(args.concurrency, 'concurrency', 1);
const checkpointEvery = integer(args['checkpoint-every'], 'checkpoint-every', 1);
const base = String(args['base-url']);
if (args.mode !== undefined && args.mode !== 'all' && args.mode !== 'continue') throw new Error('--mode must be all or continue');
console.log(`${languages.length} languages; ${pairCount.toLocaleString()} unique pairs. Limit: ${limit}; concurrency: ${concurrency}; delay: ${delay}ms.`);
if (args['dry-run']) process.exit(0);
await mkdir(dir, { recursive: true });

// Prevent collectors from overwriting checkpoints or bypassing the shared rate limit.
const lockPath = join(dir, '.compare.lock');
try {
  const lock = await open(lockPath, 'wx');
  try { await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })); }
  finally { await lock.close(); }
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
    throw new Error(`Another comparison run owns ${lockPath}. If it was force-killed, remove this lock after confirming it is no longer running.`);
  }
  throw error;
}
try {
  const removed = await removeRawHtml(dir);
  if (removed) console.log(`Removed ${removed} legacy HTML files. Only parsed JSON is retained.`);
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  const queueId = hash(JSON.stringify({ base, languages: languages.map(l => l.id) }));
  const queuePath = join(dir, 'queues', `${queueId}.json`);
  type Job = [source: string, target: string];
  // Immutable pair plan + atomic comparison files as durable acknowledgements.
  // Reconcile against those files on every resume, even after an unclean exit.
  let plan: { schemaVersion: number; sourceUrl: string; languages: string[]; jobs: Job[] };
  try { plan = JSON.parse(await readFile(queuePath, 'utf8')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const jobs: Job[] = [];
    for (let i = 0; i < languages.length; i++) {
      for (let j = i + 1; j < languages.length; j++) jobs.push([languages[i].id, languages[j].id]);
    }
    plan = { schemaVersion: 1, sourceUrl: base, languages: languages.map(l => l.id), jobs };
    await saveJson(queuePath, plan);
  }
  if (plan.schemaVersion !== 1 || plan.sourceUrl !== base ||
    JSON.stringify(plan.languages) !== JSON.stringify(languages.map(l => l.id)) || !Array.isArray(plan.jobs) || plan.jobs.length !== pairCount) {
    throw new Error(`Invalid queue plan: ${queuePath}`);
  }
  let index = 0;
  for (let i = 0; i < languages.length; i++) for (let j = i + 1; j < languages.length; j++) {
    const pair = plan.jobs[index++];
    if (!Array.isArray(pair) || pair.length !== 2 || pair[0] !== languages[i].id || pair[1] !== languages[j].id) {
      throw new Error(`Invalid pair in queue plan: ${queuePath}`);
    }
  }
  const edges = new Map<string, Pick<Comparison, 'source' | 'target' | 'distance' | 'similarity' | 'wordCount' | 'sourceUrl' | 'fetchedAt' | 'statistics'>>();
  const changedLanguages = new Set(languages.map(l => l.id));
  const addEdge = (comparison: Comparison) => {
    const { source, target, distance, similarity, wordCount, sourceUrl, fetchedAt, statistics } = comparison;
    edges.set(sourceUrl, { source, target, distance, similarity, wordCount, sourceUrl, fetchedAt, statistics });
    changedLanguages.add(source); changedLanguages.add(target);
  };
  let files: Set<string>;
  try { files = new Set(await readdir(join(dir, 'comparisons'))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    files = new Set();
  }
  const pending: Job[] = [];
  let latest: SavedComparison | null = null;
  for (const job of plan.jobs) {
    const [source, target] = job;
    const url = comparisonUrl(source, target, base);
    const filename = `${hash(url)}.json`;
    if (!files.has(filename)) { pending.push(job); continue; }
    const path = join(dir, 'comparisons', filename);
    const c: Comparison = JSON.parse(await readFile(path, 'utf8'));
    if (!c || c.schemaVersion !== 1 || c.source !== source || c.target !== target || c.sourceUrl !== url ||
      !Number.isFinite(c.distance) || c.distance < 0 || c.distance > 100) throw new Error(`Invalid comparison cache: ${path}`);
    addEdge(c);
    latest = latestComparison(latest, { source, target,
      fetchedAt: Number.isFinite(Date.parse(c.fetchedAt)) ? c.fetchedAt : (await stat(path)).mtime.toISOString() });
  }
  const cached = edges.size;
  console.log(latest ? `Latest downloaded comparison: ${latest.source} → ${latest.target} (${latest.fetchedAt}).` : 'No downloaded comparisons found for this selection.');
  console.log(`${cached.toLocaleString()} saved comparisons; ${pending.length.toLocaleString()} unfinished pairs.`);
  const offline = args['queue-only'] || args['export-only'];
  const mode = offline ? await chooseImportMode(String(args.mode ?? 'continue')) : await chooseImportMode(args.mode as string | undefined);
  if (mode === 'all') pending.length = 0;
  if (mode === 'all') for (const job of plan.jobs) pending.push(job);
  console.log(mode === 'all' ? 'Update all: fetching fresh results; existing data is kept until each refresh succeeds.' : 'Continue from latest: keeping saved comparisons and filling every unfinished pair.');
  console.log(mode === 'all'
    ? `Queue ready: ${pending.length.toLocaleString()} to fetch (${cached.toLocaleString()} existing comparisons to refresh; ${(pairCount - cached).toLocaleString()} missing).`
    : `Queue ready: ${pending.length.toLocaleString()} pending; ${cached.toLocaleString()} already collected.`);
  let stopping = false;
  const stop = () => { stopping = true; console.warn('Stopping queue; finishing active jobs and saving graph…'); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  const client = new Client(delay);
  let refreshed = 0, added = 0;
  let progress: QueueProgress = { total: pending.length, pending: pending.length, active: 0, attempted: 0, succeeded: 0, failed: 0 };
  const saveProgress = async () => saveJson(join(dir, 'queue-progress.json'), {
    schemaVersion: 1, queueFile: queuePath, updatedAt: new Date().toISOString(),
    languageCount: languages.length, total: pairCount, completed: (mode === 'all' ? 0 : cached) + progress.succeeded,
    mode, latestDownloaded: latest, availableComparisons: edges.size,
    refreshedThisRun: refreshed, addedThisRun: added,
    pending: progress.pending,
    active: progress.active, failed: progress.failed, attemptedThisRun: progress.attempted,
    concurrency, delayMs: delay,
  });
  const exportGraph = async (includeAggregate = false) => {
    const changed = new Set(changedLanguages);
    changedLanguages.clear();
    const snapshot = [...edges.values()].sort((a, b) => a.source < b.source ? -1 : a.source > b.source ? 1 : a.target < b.target ? -1 : a.target > b.target ? 1 : 0);
    try { await writeGraphFiles(join(dir, 'graph'), { nodes: languages, edges: snapshot }, changed); }
    catch (error) { for (const id of changed) changedLanguages.add(id); throw error; }
    if (!includeAggregate) return;
    await saveJson(join(dir, 'graph.json'), {
      schemaVersion: 1, generatedAt: new Date().toISOString(), sourceUrl: base,
      directed: false, distanceRange: [0, 100], similarityRange: [0, 1],
      expectedPairs: pairCount, completedPairs: snapshot.length, complete: snapshot.length === pairCount,
      nodes: languages, edges: snapshot,
    });
    const csv = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    await atomicWrite(join(dir, 'nodes.csv'), 'id,label\n' + languages.map(l => [l.id, l.label].map(csv).join(',')).join('\n') + '\n');
    const columns = ['source', 'target', 'distance', 'similarity', 'wordCount', 'sourceUrl'] as const;
    await atomicWrite(join(dir, 'edges.csv'), columns.join(',') + '\n' + snapshot.map(e => columns.map(c => csv(e[c])).join(',')).join('\n') + '\n');
  };
  await exportGraph(true); await saveProgress();
  let checkpoint = 0;
  try {
    if (!args['queue-only'] && !args['export-only']) {
      progress = await runQueue(pending, {
        concurrency, limit, shouldStop: () => stopping,
        process: async ([source, target]) => {
          const url = comparisonUrl(source, target, base);
          const key = hash(url);
          const html = await client.get(url);
          const fetchedAt = new Date().toISOString();
          const c = parseComparison(html, source, target, url, fetchedAt);
          await atomicWrite(join(dir, 'comparisons', `${key}.json`), JSON.stringify(c) + '\n');
          const existed = edges.has(url);
          addEdge(c);
          if (existed) refreshed++; else added++;
          latest = latestComparison(latest, { source, target, fetchedAt });
          console.log(`[${refreshed + added}/${pending.length} saved this run; ${edges.size}/${pairCount} available] ${existed ? 'Refreshed' : 'New'} ${source} → ${target}: ${c.distance}`);
        },
        onError: async (error, [source, target]) => {
          await appendFile(join(dir, 'failures.jsonl'), JSON.stringify({ source, target,
            sourceUrl: comparisonUrl(source, target, base), at: new Date().toISOString(), error: String(error) }) + '\n');
          console.error(`Failed ${source} / ${target}: ${String(error)}`);
        },
        onProgress: async state => {
          progress = state;
          if (state.succeeded + state.failed - checkpoint >= checkpointEvery) {
            checkpoint = state.succeeded + state.failed;
            await exportGraph();
            console.log(`Queue: ${(mode === 'all' ? 0 : cached) + state.succeeded} completed; ${state.pending} waiting; ${state.active} active; ${state.failed} failed; ${refreshed} refreshed; ${added} new; ${edges.size}/${pairCount} available.`);
          }
          await saveProgress();
        },
      });
    }
  } finally {
    await exportGraph(true); await saveProgress();
    process.off('SIGINT', stop); process.off('SIGTERM', stop);
  }
  console.log(`Exported ${edges.size}/${pairCount} edges (${refreshed} refreshed, ${added} new, ${progress.failed} failed; ${cached} previously cached). Queue saved in ${queuePath}.`);
  if (progress.failed) process.exitCode = 1;
  else if (stopping) process.exitCode = 130;
} catch (error) {
  if (error instanceof ImportCancelled) console.log('Import cancelled. No requests started.');
  else throw error;
} finally { await unlink(lockPath); }
