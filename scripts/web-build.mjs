import { mkdir, copyFile, cp, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { graphFileName, ensureGraphFiles } from './graph-files.ts';
import { readCatalog } from './catalog.mjs';
import { compileFrontend } from './web-compile.mjs';
import { syncFrontendAssets } from './web-assets.mjs';
const base = new URL('../', import.meta.url);
export async function buildWebsite({ production = true, basePath = process.env.SITE_BASE_PATH ?? '' } = {}) {
  // dist contains only reproducible outputs; every build starts from an empty tree.
  await rm(new URL('web/dist/', base), { recursive: true, force: true });
  await compileFrontend({ production });
  await mkdir(new URL('web/dist/vendor/', base), { recursive: true });
  await copyFile(new URL('node_modules/d3/dist/d3.min.js', base), new URL('web/dist/vendor/d3.min.js', base));
  await mkdir(new URL('web/dist/vendor/leaflet/', base), { recursive: true });
  for (const filename of ['leaflet.js', 'leaflet.css']) {
    await copyFile(new URL(`node_modules/leaflet/dist/${filename}`, base), new URL(`web/dist/vendor/leaflet/${filename}`, base));
  }
  await cp(new URL('node_modules/leaflet/dist/images/', base), new URL('web/dist/vendor/leaflet/images/', base), { recursive: true });
  try { await copyFile(new URL('data/languages-enriched.json', base), new URL('web/dist/languages-enriched.json', base)); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    console.warn('Map locations are not generated yet. Run npm run map:languages to enable geographic pins.');
  }
  const index = await ensureGraphFiles(fileURLToPath(new URL('data/', base)));
  const catalog = await readCatalog(fileURLToPath(new URL('data/', base)));
  await writeFile(new URL('web/dist/languages.json', base), JSON.stringify(catalog) + '\n');
  await syncFrontendAssets({ catalog, production, basePath });
  await mkdir(new URL('web/dist/graphs/', base), { recursive: true });
  for (const language of index.languages) {
    const filename = graphFileName(language.id);
    await copyFile(new URL(`data/graph/languages/${filename}`, base), new URL(`web/dist/graphs/${filename}`, base));
  }
  console.log(`Web app ready: embedded language index and ${index.languages.length} separate graph files. No aggregate graph in web/dist.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await buildWebsite();
