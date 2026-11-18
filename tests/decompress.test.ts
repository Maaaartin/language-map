import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/decompress-comparisons.mjs', import.meta.url));

test('missing comparison archive leaves existing JSON files untouched', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'language-decompress-'));
  try {
    const comparisons = join(directory, 'data/comparisons');
    await mkdir(comparisons, { recursive: true });
    const file = join(comparisons, 'existing.json');
    await writeFile(file, '{"existing":true}');
    const result = spawnSync(process.execPath, [script], { cwd: directory, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Cannot read comparisons.tar.gz/);
    assert.equal(await readFile(file, 'utf8'), '{"existing":true}');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('decompression restores deleted comparisons and preserves files outside the archive', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'language-decompress-'));
  try {
    const comparisons = join(directory, 'data/comparisons');
    await mkdir(comparisons, { recursive: true });
    const restored = join(comparisons, 'restored.json');
    await writeFile(restored, '{"restored":true}');
    const archive = spawnSync('tar', ['-czf', 'comparisons.tar.gz', 'data/comparisons/'], { cwd: directory });
    assert.equal(archive.status, 0, archive.stderr.toString());
    await rm(comparisons, { recursive: true });
    let result = spawnSync(process.execPath, [script], { cwd: directory, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(restored, 'utf8'), '{"restored":true}');
    await writeFile(join(comparisons, 'extra.json'), '{"extra":true}');
    await rm(restored);
    result = spawnSync(process.execPath, [script], { cwd: directory, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(restored, 'utf8'), '{"restored":true}');
    assert.equal(await readFile(join(comparisons, 'extra.json'), 'utf8'), '{"extra":true}');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
