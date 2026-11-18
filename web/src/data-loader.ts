import { sitePath } from './site-path.js';

// Per-page JSON cache: reuse preloaded HTTP responses and in-flight requests.
export function createJsonLoader({ fetcher = globalThis.fetch.bind(globalThis), ttlMs = 15_000,
  maxEntries = 32 }: { fetcher?: typeof fetch; ttlMs?: number; maxEntries?: number } = {}) {
  interface Entry { ready: boolean; expires: number; promise: Promise<unknown> }
  const entries = new Map<string, Entry>();
  const prune = () => {
    for (const [path, entry] of entries) {
      if (entries.size <= maxEntries) break;
      if (entry.ready) entries.delete(path);
    }
  };
  const json = (path: string, { priority = 'auto' }: { priority?: RequestPriority } = {}): Promise<unknown> => {
    const cached = entries.get(path);
    if (cached && (!cached.ready || cached.expires > Date.now())) {
      entries.delete(path); entries.set(path, cached);
      return cached.promise;
    }
    const entry: Entry = { ready: false, expires: 0, promise: Promise.resolve(undefined) };
    entry.promise = (async () => {
      const response = await fetcher(sitePath(path), { cache: 'default', priority });
      if (!response.ok) throw new Error(`HTTP ${response.status} loading ${path}`);
      return response.json();
    })().then(data => {
      entry.ready = true; entry.expires = Date.now() + ttlMs; prune();
      return data;
    }, error => {
      if (entries.get(path) === entry) entries.delete(path);
      throw error;
    });
    entries.set(path, entry); prune();
    return entry.promise;
  };
  return { json, invalidate(path: string) { entries.delete(path); }, dispose() { entries.clear(); } };
}
