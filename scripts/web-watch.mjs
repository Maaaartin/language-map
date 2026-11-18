import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startFrontendCompiler } from './web-compile.mjs';
import { watchFrontendAssets } from './web-asset-watch.mjs';
import { join } from 'node:path';

// Complete a successful initial build before starting the server or the watcher.
await import('./web-build.mjs');
const root = fileURLToPath(new URL('../', import.meta.url));
const compiler = startFrontendCompiler({ watch: true, stdio: ['inherit', 'pipe', 'inherit'] });
const children = [compiler,
  spawn(process.execPath, [fileURLToPath(new URL('./web-dev.mjs', import.meta.url))], { cwd: root, stdio: 'inherit' })];
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  void assetWatcher.close();
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
};
const assetWatcher = watchFrontendAssets({
  sourceDirectory: join(root, 'web/src'), outputDirectory: join(root, 'web/dist'), dataDirectory: join(root, 'data'),
  onError: error => { console.error(error.message); process.exitCode = 1; stop(); },
});
// Reconcile after every tsc watch cycle, including deletion and error cycles.
// This removes outputs tsc leaves behind for renamed/deleted TypeScript sources.
let compilerOutput = '';
compiler.stdout.on('data', chunk => {
  process.stdout.write(chunk);
  compilerOutput += chunk;
  if (compilerOutput.includes('Watching for file changes.')) { compilerOutput = ''; assetWatcher.schedule(); }
  else compilerOutput = compilerOutput.slice(-2000);
});
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
await Promise.all(children.map(child => new Promise(resolve => {
  child.once('error', error => { console.error(error.message); process.exitCode = 1; stop(); resolve(); });
  child.once('exit', (code, signal) => {
    if (!stopping) { process.exitCode = code ?? (signal ? 1 : 0); stop(); }
    resolve();
  });
})));
await assetWatcher.close();
