import { parseArgs } from 'node:util';
import { splitGraphFile } from './graph-files.js';
const { values } = parseArgs({ options: { 'data-dir': { type: 'string', default: 'data' } } });
const index = await splitGraphFile(values['data-dir']);
console.log(`Generated ${index.languages.length} per-language graph files from ${index.comparisonCount} comparisons. No requests made.`);
