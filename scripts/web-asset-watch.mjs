import { watch } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { syncFrontendAssets } from './web-assets.mjs';

async function fileStamp(path) {
  try {
    const info = await stat(path);
    return `${path}:${info.mtimeMs}:${info.ctimeMs}:${info.size}`;
  } catch (error) { if (error.code === 'ENOENT') return `${path}:missing`; throw error; }
}
async function sourceStamp(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return Promise.all(entries.sort((a, b) => a.name.localeCompare(b.name)).map(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceStamp(path) : fileStamp(path);
  }));
}

export function watchFrontendAssets({ sourceDirectory, outputDirectory, dataDirectory, onError, onSynced = () => {} }) {
  let timer, closed = false, syncing = Promise.resolve();
  const schedule = () => {
    if (closed) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      syncing = syncing.then(async () => {
        if (closed) return;
        await syncFrontendAssets({ sourceDirectory, outputDirectory, dataDirectory });
        onSynced();
      }).catch(onError);
    }, 75);
  };
  const watchers = [
    watch(sourceDirectory, { recursive: true }, (_event, name) => {
      if (!name || !String(name).endsWith('.ts')) schedule();
    }),
    // Avoid recursively watching the much larger comparison dataset.
    watch(dataDirectory, (_event, name) => {
      if (!name || String(name) === 'languages-enriched.json') schedule();
    }),
    watch(join(dataDirectory, 'graph'), (_event, name) => {
      if (!name || String(name) === 'index.json') schedule();
    }),
  ];
  for (const watcher of watchers) watcher.on('error', onError);
  // Some editors and filesystems drop native watch events. Check only source
  // metadata and the two catalog inputs, never the comparison dataset.
  let previousStamp, polling = false;
  const poll = async () => {
    if (closed || polling) return;
    polling = true;
    try {
      const stamp = JSON.stringify(await Promise.all([
        sourceStamp(sourceDirectory), fileStamp(join(dataDirectory, 'graph/index.json')),
        fileStamp(join(dataDirectory, 'languages-enriched.json')),
      ]));
      if (stamp !== previousStamp) { previousStamp = stamp; schedule(); }
    } catch (error) { if (!closed) onError(error); }
    finally { polling = false; }
  };
  const pollTimer = setInterval(poll, 750);
  void poll();
  return {
    schedule,
    async close() {
      closed = true; clearTimeout(timer); clearInterval(pollTimer);
      for (const watcher of watchers) watcher.close();
      await syncing;
    },
  };
}
