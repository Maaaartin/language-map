import { join } from 'node:path';
import { Client, integer, options, parseLanguages, saveJson } from './lib.js';

const args = options();
const dir = String(args['data-dir']);
const sourceUrl = String(args['base-url']);
const client = new Client(integer(args['delay-ms'], 'delay-ms'));
const html = await client.get(sourceUrl);
const languages = parseLanguages(html);
await saveJson(join(dir, 'languages.json'), {
  schemaVersion: 1, sourceUrl, fetchedAt: new Date().toISOString(), languages,
});
console.log(`Saved ${languages.length} languages to ${join(dir, 'languages.json')}`);
