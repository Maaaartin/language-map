import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCatalog } from './catalog.mjs';
import { catalogPlaceholder, embedCatalog } from './html-pages.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifestName = '.source-outputs.json';

async function filesIn(directory) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const files = [];
  for (const entry of entries) {
    if (entry.name === '.DS_Store') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesIn(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

export async function syncFrontendAssets({ sourceDirectory = join(root, 'web/src'),
  outputDirectory = join(root, 'web/dist'), dataDirectory = join(root, 'data'), catalog } = {}) {
  const source = resolve(sourceDirectory), output = resolve(outputDirectory);
  if (source === output || source.startsWith(output + '/') || output.startsWith(source + '/')) throw new Error('Frontend source must be outside dist');
  const inputs = await filesIn(source);
  const expected = new Set();
  const assets = [];
  for (const file of inputs) {
    const name = relative(source, file).split('\\').join('/');
    if (name.endsWith('.d.ts')) continue;
    if (name.endsWith('.ts')) {
      const base = name.slice(0, -3);
      for (const extension of ['.js', '.js.map', '.d.ts']) expected.add(base + extension);
    } else { expected.add(name); assets.push({ file, name }); }
  }
  await mkdir(output, { recursive: true });
  let previous = [];
  try { previous = JSON.parse(await readFile(join(output, manifestName), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const name of previous) {
    if (expected.has(name)) continue;
    const path = resolve(output, name);
    if (!path.startsWith(output + '/')) throw new Error('Invalid frontend output manifest');
    await rm(path, { force: true });
  }
  // tsc does not remove outputs of deleted sources. Also catch late emissions
  // after an earlier source-change sync, even if they left the manifest already.
  for (const path of await filesIn(output)) {
    const name = relative(output, path).split('\\').join('/');
    if (name.startsWith('vendor/') || name.startsWith('graphs/')) continue;
    if (/\.(?:js|js\.map|d\.ts|d\.ts\.map)$/.test(name) && !expected.has(name)) await rm(path, { force: true });
  }
  for (const { file, name } of assets) {
    const destination = join(output, name);
    await mkdir(dirname(destination), { recursive: true });
    if (name.endsWith('.html')) {
      const template = await readFile(file, 'utf8');
      const embedded = name === 'index.html' || name === 'map/index.html' || template.includes(catalogPlaceholder);
      if (embedded) catalog ??= await readCatalog(dataDirectory);
      await writeFile(destination, embedded ? embedCatalog(template, catalog) : template);
    } else await copyFile(file, destination);
  }
  await writeFile(join(output, manifestName), JSON.stringify([...expected].sort()) + '\n');
}
