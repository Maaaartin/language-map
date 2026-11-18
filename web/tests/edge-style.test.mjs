import { test } from 'node:test';
import assert from 'node:assert/strict';
import { similarityWidth } from '../dist/edge-style.js';

test('shared connection widths strictly increase with similarity and handle limits safely', () => {
  const values = [0, .1, .3, .5, .7, .9, 1].map(similarityWidth);
  assert.equal(values[0], .8); assert.equal(values.at(-1), 9);
  assert.ok(values.every((value, i) => i === 0 || value > values[i - 1]));
  assert.ok(similarityWidth(.9) > similarityWidth(.3) * 3);
  assert.equal(similarityWidth(-1), similarityWidth(0));
  assert.equal(similarityWidth(2), similarityWidth(1));
  assert.equal(similarityWidth(NaN), similarityWidth(0));
});
