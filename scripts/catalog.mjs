import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Keep live scrape checkpoints independent of the derived classification mapping.
export async function readCatalog(directory) {
  const index = JSON.parse(await readFile(join(directory, 'graph/index.json'), 'utf8'));
  let mapped = new Map();
  try {
    const enriched = JSON.parse(await readFile(join(directory, 'languages-enriched.json'), 'utf8'));
    mapped = new Map(enriched.languages.map(language => [language.id, language]));
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { ...index, languages: index.languages.map(language => {
    const match = mapped.get(language.id);
    return { ...language, classification: match?.label === language.label ? match.classification ?? null : null };
  }) };
}
