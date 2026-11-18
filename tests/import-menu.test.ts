import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { chooseImportMode, latestComparison, ImportCancelled } from '../scripts/import-menu.js';

test('latest comparison uses fetch time rather than pair ordering', () => {
  const newer = { source: 'A', target: 'B', fetchedAt: '2026-11-14T12:00:00Z' };
  const older = { source: 'X', target: 'Z', fetchedAt: '2026-11-13T12:00:00Z' };
  assert.deepEqual(latestComparison(null, older), older);
  assert.deepEqual(latestComparison(newer, older), newer);
  assert.deepEqual(latestComparison(older, newer), newer);
  assert.equal(latestComparison(null, { ...older, fetchedAt: 'invalid' }), null);
});
test('menu supports both choices and defaults to continue on Enter', async () => {
  for (const [answer, expected] of [['1', 'all'], ['2', 'continue'], ['', 'continue']] as const) {
    const input = new PassThrough(), output = new PassThrough();
    let printed = ''; output.on('data', chunk => { printed += chunk; });
    const result = chooseImportMode(undefined, { input, output, interactive: true });
    input.write(`${answer}\n`);
    assert.equal(await result, expected);
    assert.match(printed, /Update all/);
    assert.match(printed, /Continue from latest/);
    input.destroy(); output.destroy();
  }
});
test('explicit and noninteractive modes do not prompt; invalid modes fail', async () => {
  const input = new PassThrough(), output = new PassThrough();
  let printed = ''; output.on('data', chunk => { printed += chunk; });
  assert.equal(await chooseImportMode(undefined, { input, output, interactive: false }), 'continue');
  assert.equal(await chooseImportMode('all', { input, output, interactive: true }), 'all');
  await assert.rejects(chooseImportMode('bad', { input, output, interactive: false }), /--mode/);
  assert.equal(printed, '');
  input.destroy(); output.destroy();
});
test('closing menu input cancels without choosing an action', async () => {
  const input = new PassThrough(), output = new PassThrough();
  const result = chooseImportMode(undefined, { input, output, interactive: true });
  input.end();
  await assert.rejects(result, ImportCancelled);
  output.destroy();
});
