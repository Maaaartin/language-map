import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readCatalog } from './catalog.mjs';
import { createHash } from 'node:crypto';
import { embedCatalog } from './html-pages.mjs';
const defaultStaticDirectory = fileURLToPath(new URL('../web/dist/', import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png' };
export function createWebServer({ dataDirectory = fileURLToPath(new URL('../data/', import.meta.url)),
  staticDirectory = defaultStaticDirectory,
  templateDirectory = staticDirectory === defaultStaticDirectory ? fileURLToPath(new URL('../web/src/', import.meta.url)) : staticDirectory } = {}) {
  const root = resolve(staticDirectory);
  const templates = resolve(templateDirectory);
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const pathname = decodeURIComponent(url.pathname);
      const graphPage = pathname === '/' || pathname === '/index.html';
      const mapPage = ['/map', '/map/', '/map/index.html'].includes(pathname);
      if (pathname === '/graph.json') { res.writeHead(404).end('Use a per-language graph'); return; }
      const match = pathname.match(/^\/graphs\/([a-f0-9]{64}\.json)$/);
      const isData = pathname === '/languages.json' || pathname === '/languages-enriched.json' || Boolean(match);
      const path = pathname === '/languages.json' ? join(dataDirectory, 'graph/index.json')
        : pathname === '/languages-enriched.json' ? join(dataDirectory, 'languages-enriched.json')
        : match ? join(dataDirectory, 'graph/languages', match[1])
        : graphPage || mapPage ? join(templates, graphPage ? 'index.html' : 'map/index.html')
        : resolve(root, `.${pathname}`);
      if (!isData && !graphPage && !mapPage && !path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
      let catalog;
      let body;
      if (graphPage || mapPage) {
        catalog = await readCatalog(dataDirectory);
        body = Buffer.from(embedCatalog(await readFile(path, 'utf8'), catalog));
      } else body = pathname === '/languages.json' ? Buffer.from(JSON.stringify(await readCatalog(dataDirectory))) : await readFile(path);
      const headers = { 'Content-Type': mime[extname(path)] || 'application/octet-stream',
        'Cache-Control': 'no-cache', ETag: `"${createHash('sha256').update(body).digest('base64url')}"` };
      if (graphPage || mapPage) {
        const preloads = new Set(mapPage ? ['/languages-enriched.json'] : []);
        if (url.searchParams.has('language') && (!mapPage || url.searchParams.get('connections') !== 'none')) {
          const language = catalog.languages.find(n => n.id === url.searchParams.get('language'));
          if (language && /^\/graphs\/[a-f0-9]{64}\.json$/.test(language.graphFile)) preloads.add(language.graphFile);
        }
        if (preloads.size) headers.Link = [...preloads].map(path => `<${path}>; rel=preload; as=fetch; crossorigin=anonymous`).join(', ');
      }
      const tags = String(req.headers['if-none-match'] ?? '').split(',').map(tag => tag.trim().replace(/^W\//, ''));
      if (tags.includes(headers.ETag) || tags.includes('*')) { res.writeHead(304, headers).end(); return; }
      res.writeHead(200, headers);
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch { res.writeHead(404).end('Not found'); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 5173);
  createWebServer().listen(port, '127.0.0.1', () => console.log(`Language Map: http://localhost:${port}`));
}
