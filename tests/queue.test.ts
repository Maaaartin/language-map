import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setImmediate } from 'node:timers/promises';
import { runQueue } from '../scripts/queue.js';
import { Client, sleep } from '../scripts/lib.js';
import { graphFileName } from '../scripts/graph-files.js';

test('workers enforce concurrency and limit, keep going after errors, and do not duplicate jobs', async () => {
  let active = 0, peak = 0;
  const seen: number[] = [], failed: number[] = [];
  const result = await runQueue(Array.from({ length: 20 }, (_, i) => i), {
    concurrency: 3, limit: 8, shouldStop: () => false,
    process: async n => { active++; peak = Math.max(peak, active); seen.push(n); await sleep(10); active--; if (n === 2) throw new Error('failure'); },
    onError: async (_, n) => { failed.push(n); },
  });
  assert.equal(peak, 3);
  assert.deepEqual(seen.sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(failed, [2]);
  assert.deepEqual(result, { total: 20, pending: 12, active: 0, attempted: 8, succeeded: 7, failed: 1 });
});
test('stop finishes active work without dequeuing the remainder', async () => {
  let stopping = false;
  const seen: number[] = [];
  const result = await runQueue([1, 2, 3], {
    concurrency: 1, limit: Infinity, shouldStop: () => stopping,
    process: async n => { seen.push(n); stopping = true; }, onError: async () => {},
  });
  assert.deepEqual(seen, [1]);
  assert.equal(result.pending, 2);
});

test('CLI queues every language, limits active requests, checkpoints, and resumes failures', async () => {
  const html = await readFile(new URL('./fixtures/altai-uzbek.html', import.meta.url), 'utf8');
  const dir = await mkdtemp(join(tmpdir(), 'language-queue-'));
  let active = 0, peak = 0, fail = true, refreshed = false;
  const requested: string[] = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    const source = url.searchParams.get('Language1'), target = url.searchParams.get('Language2');
    requested.push(`${source}/${target}`);
    active++; peak = Math.max(peak, active);
    await sleep(40);
    if (source === 'A' && target === 'C' && fail) { res.statusCode = 404; res.end('Unavailable'); }
    else res.end(html.replaceAll('Comparison Altai to Uzbek', `Comparison ${source} to ${target}`)
      .replace('Distance: 18,43', refreshed ? 'Distance: 22,22' : 'Distance: 18,43'));
    active--;
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address(); assert.ok(addr && typeof addr !== 'string');
  const base = `http://127.0.0.1:${addr.port}/Compare_Languages.aspx`;
  const run = (...extra: string[]) => promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/compare.ts',
    '--data-dir', dir, '--base-url', base, '--delay-ms', '0', '--checkpoint-every', '1', ...extra]);
  const read = async (name: string) => JSON.parse(await readFile(join(dir, name), 'utf8'));
  try {
    await writeFile(join(dir, 'languages.json'), JSON.stringify({ schemaVersion: 1, languages: ['C', 'A', 'B'].map(id => ({ id, label: id })) }));
    await run('--queue-only');
    assert.equal(requested.length, 0);
    let graph = await read('graph.json');
    assert.equal(graph.nodes.length, 3);
    assert.equal(graph.expectedPairs, 3);
    let progress = await read('queue-progress.json');
    const plan = JSON.parse(await readFile(progress.queueFile, 'utf8'));
    assert.deepEqual(plan.jobs, [['A', 'B'], ['A', 'C'], ['B', 'C']]);
    assert.equal(progress.pending, 3);
    const limited = await run('--limit', '1');
    assert.match(limited.stdout, /Queue: 1 completed/);
    assert.match(limited.stdout, /\[1\/3 saved this run; 1\/3 available\] New A → B/);
    assert.equal((await read('queue-progress.json')).addedThisRun, 1);
    assert.equal((await read('queue-progress.json')).refreshedThisRun, 0);
    assert.equal((await read('graph.json')).edges.length, 1);
    assert.equal((await read(`graph/languages/${graphFileName('A')}`)).edges.length, 1);
    assert.equal((await read(`graph/languages/${graphFileName('B')}`)).edges.length, 1);
    assert.equal((await read(`graph/languages/${graphFileName('C')}`)).edges.length, 0);
    await assert.rejects(run(), /Failed A \/ C/);
    progress = await read('queue-progress.json');
    assert.equal(progress.completed, 2);
    assert.equal(progress.failed, 1);
    assert.equal(progress.active, 0);
    assert.equal(peak, 1);
    fail = false;
    await run('--concurrency', '2');
    graph = await read('graph.json');
    assert.equal(graph.complete, true);
    assert.equal(graph.edges.length, 3);
    assert.deepEqual(requested, ['A/B', 'A/C', 'B/C', 'A/C']);
    await run();
    assert.equal(requested.length, 4);
    assert.equal((await read('queue-progress.json')).pending, 0);
    // Latest comes from saved fetch times, not the last pair in alphabetical order.
    for (const file of await readdir(join(dir, 'comparisons'))) {
      const path = join(dir, 'comparisons', file);
      const c = JSON.parse(await readFile(path, 'utf8'));
      c.fetchedAt = c.source === 'A' && c.target === 'C' ? '2022-01-01T00:00:00Z' : '2020-01-01T00:00:00Z';
      await writeFile(path, JSON.stringify(c));
    }
    const continuation = await run('--mode', 'continue');
    assert.match(continuation.stdout, /Latest downloaded comparison: A → C \(2022/);
    assert.equal(requested.length, 4);
    refreshed = true; fail = true;
    await assert.rejects(run('--mode', 'all'), /Failed A \/ C/);
    graph = await read('graph.json');
    assert.equal(graph.edges.length, 3); // Replaces results without duplicate edges.
    assert.equal(graph.edges.find((e: { source: string; target: string }) => e.source === 'A' && e.target === 'B').distance, 22.22);
    assert.equal(graph.edges.find((e: { source: string; target: string }) => e.source === 'A' && e.target === 'C').distance, 18.43); // Failed refresh retains old data.
    progress = await read('queue-progress.json');
    assert.equal(progress.mode, 'all');
    assert.equal(progress.completed, 2);
    assert.equal(progress.failed, 1);
    assert.equal(progress.availableComparisons, 3);
    assert.equal(requested.length, 7); // Refresh fetches again even when parsed JSON exists.
    fail = false;
    const refresh = await run('--mode', 'all');
    assert.match(refresh.stdout, /3 to fetch \(3 existing comparisons to refresh; 0 missing\)/);
    assert.match(refresh.stdout, /\[1\/3 saved this run; 3\/3 available\] Refreshed A → B/);
    assert.match(refresh.stdout, /\[3\/3 saved this run; 3\/3 available\] Refreshed B → C/);
    assert.equal((await read('queue-progress.json')).refreshedThisRun, 3);
    assert.equal((await read('queue-progress.json')).addedThisRun, 0);
    assert.equal(requested.length, 10);
    assert.equal((await read('queue-progress.json')).completed, 3);
    assert.equal((await read('graph/index.json')).comparisonCount, 3);
    const bGraph = await read(`graph/languages/${graphFileName('B')}`);
    assert.equal(bGraph.edges.length, 2);
    assert.ok(bGraph.edges.every((e: { source: string; target: string; distance: number }) => (e.source === 'B' || e.target === 'B') && e.distance === 22.22));
    // A second collector must not overwrite state owned by a live collector.
    await writeFile(join(dir, '.compare.lock'), '{}');
    await assert.rejects(run('--queue-only'), /Another comparison run/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
test('concurrent HTTP workers share the request-start interval', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
  const starts: number[] = [];
  let active = 0;
  // Observe client starts directly: socket setup and server scheduling can bunch
  // arrival times even when fetch calls are correctly spaced.
  t.mock.method(globalThis, 'fetch', async () => {
    starts.push(Date.now()); active++;
    await sleep(150);
    active--;
    return new Response('ok');
  });
  const client = new Client(60);
  const responses = Promise.all([1, 2, 3].map(() => client.get('https://example.test/')));
  // Flush promise continuations using the real event loop after each clock step.
  await setImmediate();
  assert.deepEqual(starts, [1000]);
  for (const expected of [[1000, 1060], [1000, 1060, 1120]]) {
    t.mock.timers.tick(59);
    await setImmediate();
    assert.deepEqual(starts, expected.slice(0, -1));
    t.mock.timers.tick(1);
    await setImmediate();
    assert.deepEqual(starts, expected);
  }
  assert.equal(active, 3); // Spacing starts must still allow overlapping requests.
  t.mock.timers.tick(150);
  assert.deepEqual(await responses, ['ok', 'ok', 'ok']);
  assert.equal(active, 0);
});
