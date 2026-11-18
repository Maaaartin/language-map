import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/comparison-release.mjs', import.meta.url));

async function fixture(scenario: string, action: string, archive = true) {
  const directory = await mkdtemp(join(tmpdir(), 'comparison-release-'));
  const file = join(directory, 'comparisons.tar.gz');
  const log = join(directory, 'calls.jsonl');
  await writeFile(join(directory, 'gh'), `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CALL_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'api' && process.env.SCENARIO === 'missing-release') {
  console.error('gh: Not Found (HTTP 404)'); process.exit(1);
}
if (args[0] === 'api' && process.env.SCENARIO === 'network-failure') {
  console.error('connection failed'); process.exit(1);
}
if (args[1] === 'download') {
  fs.writeFileSync(path.join(args[args.indexOf('--dir') + 1], 'comparisons.tar.gz'), 'downloaded');
  if (process.env.SCENARIO === 'failed-download') process.exit(1);
}
`);
  await chmod(join(directory, 'gh'), 0o755);
  if (archive) await writeFile(file, 'original');
  const result = spawnSync(process.execPath, [script, action], {
    cwd: directory, encoding: 'utf8',
    env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, SCENARIO: scenario, CALL_LOG: log },
  });
  return { directory, file, log, result };
}

for (const scenario of ['missing-release', 'existing-release', 'network-failure']) {
  test(`release upload handles ${scenario}`, async () => {
    const { directory, log, result } = await fixture(scenario, 'upload');
    try {
      const calls: string[][] = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
      if (scenario === 'network-failure') {
        assert.equal(result.status, 1);
        assert.match(result.stderr, /connection failed/);
        assert.equal(calls.length, 2);
      } else {
        assert.equal(result.status, 0, result.stderr);
        assert.equal(calls[2][1], scenario === 'missing-release' ? 'create' : 'upload');
        assert.ok(calls[2].includes('comparisons.tar.gz'));
        assert.ok(calls[2].includes('Maaaartin/language-map'));
        assert.ok(!calls[2].includes('--clobber'));
      }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
}

test('missing upload archive fails before calling GitHub', async () => {
  const { directory, result } = await fixture('existing-release', 'upload', false);
  try {
    assert.equal(result.status, 1);
    assert.match(result.stderr, /npm run compress:comparisons/);
    assert.ok(!(await readdir(directory)).includes('calls.jsonl'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

for (const scenario of ['successful-download', 'failed-download']) {
  test(`release download handles ${scenario} without leaving temporary files`, async () => {
    const { directory, file, result } = await fixture(scenario, 'download');
    try {
      assert.equal(result.status, scenario === 'successful-download' ? 0 : 1, result.stderr);
      assert.equal(await readFile(file, 'utf8'), scenario === 'successful-download' ? 'downloaded' : 'original');
      assert.ok(!(await readdir(directory)).some(name => name.startsWith('.comparison-download-')));
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
}
