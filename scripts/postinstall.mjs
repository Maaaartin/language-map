import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({ options: {
  'data-dir': { type: 'string', default: join(root, 'data') },
} });
const dataDir = resolve(values['data-dir']);
const csv = join(dataDir, 'glottolog/languages.csv');

async function run(script, args = []) {
  const child = spawn(process.execPath, [
    '--import', 'tsx', join(root, 'scripts', script), ...args,
  ], { cwd: root, stdio: 'inherit' });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() :
      reject(new Error(`${script} failed (${signal ?? code})`)));
  });
}

// Installation only derives data from the checked-in sources; no downloads.
await run('map-languages.ts', ['--data-dir', dataDir, '--csv', csv, '--summary']);
