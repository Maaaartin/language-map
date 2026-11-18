import type { LanguageCatalog } from './types.js';
const catalogs = new WeakMap<Document, LanguageCatalog>();

export function readLanguageData(page: Document = document): LanguageCatalog {
  if (catalogs.has(page)) return catalogs.get(page)!;
  const element = page.getElementById('language-data');
  if (!element) throw new Error('Language data is missing. Run npm run build or use npm run dev.');
  const metadata = JSON.parse(element.textContent);
  if (!metadata || !Array.isArray(metadata.languages)) throw new Error('Invalid embedded language data');
  catalogs.set(page, metadata);
  return metadata;
}
