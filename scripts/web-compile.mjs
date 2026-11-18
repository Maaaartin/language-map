import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

export function startFrontendCompiler({ watch = false, stdio = 'inherit' } = {}) {
  return spawn(process.execPath, [
    resolve(root, 'node_modules/typescript/lib/tsc.js'),
    '--project', resolve(root, 'tsconfig.web.json'),
    ...(watch ? ['--watch', '--preserveWatchOutput', '--locale', 'en'] : []),
  ], { cwd: root, stdio });
}

export async function compileFrontend() {
  const child = startFrontendCompiler();
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() :
      reject(new Error(`Frontend TypeScript compilation failed (${signal ?? code})`)));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await compileFrontend();
