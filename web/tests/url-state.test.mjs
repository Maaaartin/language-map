import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readUrlState, writeUrlState } from '../dist/url-state.js';

test('URL state round-trips a centered language, pair, threshold and encoded language IDs', () => {
  const state = { center: 'Albanian_(Gheg)', compare: 'A & B', similarity: 45, levels: 2, grouping: 'family', groupLanguages: true };
  const href = writeUrlState('http://localhost/?other=keep#map', state);
  assert.deepEqual(readUrlState(href, [state.center, state.compare]), state);
  assert.equal(new URL(href).searchParams.get('other'), 'keep');
  assert.equal(new URL(href).hash, '#map');
});
test('invalid URL values do not select the first language or invent comparisons', () => {
  assert.deepEqual(readUrlState('http://localhost/?language=missing&compare=B&similarity=NaN', ['A', 'B']), { center: null, compare: null, similarity: null, levels: 1, grouping: 'branch', groupLanguages: false });
  assert.deepEqual(readUrlState('http://localhost/?language=A&compare=A&similarity=101', ['A']), { center: 'A', compare: null, similarity: null, levels: 1, grouping: 'branch', groupLanguages: false });
  assert.equal(readUrlState('http://localhost/?language=A&similarity=0', ['A']).similarity, 0);
  assert.equal(readUrlState('http://localhost/?similarity=', ['A']).similarity, null);
  const cleared = new URL(writeUrlState('http://localhost/?language=A&compare=B&similarity=30', { center: null, compare: null, similarity: null, levels: 1, grouping: 'branch' }));
  assert.equal(cleared.search, '');
});

test('manual ten percent stays explicit while missing similarity requests an automatic default', () => {
  const href = writeUrlState('http://localhost/?displayAll=true', { center: 'A', compare: null, similarity: 10 });
  assert.equal(new URL(href).searchParams.get('similarity'), '10');
  assert.equal(new URL(href).searchParams.has('displayAll'), false);
  assert.equal(readUrlState('http://localhost/?language=A', ['A']).similarity, null);
});

test('neighbor levels default to one and round-trip levels two through five', () => {
  for (const value of ['', '1', '0', '6', '2.5', 'invalid']) {
    assert.equal(readUrlState(`http://localhost/?levels=${value}`, []).levels, 1);
  }
  for (const levels of [2, 3, 4, 5]) {
    const href = writeUrlState('http://localhost/', { center: 'A', similarity: null, levels });
    assert.equal(new URL(href).searchParams.get('levels'), String(levels));
    assert.equal(readUrlState(href, ['A']).levels, levels);
    assert.equal(new URL(writeUrlState(href, { center: 'A', similarity: null, levels: 1, grouping: 'branch' })).searchParams.has('levels'), false);
  }
});

test('family grouping is restored explicitly and invalid modes use subgroups', () => {
  assert.equal(readUrlState('http://localhost/?grouping=family', []).grouping, 'family');
  assert.equal(readUrlState('http://localhost/?grouping=invalid', []).grouping, 'branch');
});
