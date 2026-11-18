import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJsonLoader } from '../dist/data-loader.js';

const path = id => `/graphs/${String(id).padStart(64, '0')}.json`;

test('navigation shares an in-flight download and reuses the completed response', async () => {
  let requests = 0, release;
  const loader = createJsonLoader({ fetcher: async () => {
    requests++; await new Promise(resolve => { release = resolve; });
    return { ok: true, json: async () => ({ value: 1 }) };
  } });
  const first = loader.json(path(0));
  const second = loader.json(path(0));
  assert.equal(requests, 1);
  release();
  assert.deepEqual(await first, { value: 1 });
  assert.deepEqual(await second, { value: 1 });
  await loader.json(path(0)); assert.equal(requests, 1);
  loader.dispose();
});

test('failed requests retry on demand and cache entries can expire or be invalidated', async () => {
  let requests = 0;
  const loader = createJsonLoader({ fetcher: async () => {
    requests++; return requests === 1 ? { ok: false, status: 503 } : { ok: true, json: async () => requests };
  } });
  await assert.rejects(loader.json(path(1)), /HTTP 503/);
  assert.equal(await loader.json(path(1)), 2);
  assert.equal(await loader.json(path(1)), 2);
  loader.invalidate(path(1)); assert.equal(await loader.json(path(1)), 3);
  loader.dispose();
  const expired = createJsonLoader({ ttlMs: 0, fetcher: async () => ({ ok: true, json: async () => ++requests }) });
  await expired.json(path(2)); await expired.json(path(2)); assert.equal(requests, 5);
  expired.dispose();
});
