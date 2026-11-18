import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import type { Readable, Writable } from 'node:stream';

export type ImportMode = 'all' | 'continue';
export interface SavedComparison { source: string; target: string; fetchedAt: string }
export class ImportCancelled extends Error {}

export function latestComparison(current: SavedComparison | null, candidate: SavedComparison): SavedComparison | null {
  const time = Date.parse(candidate.fetchedAt);
  return Number.isFinite(time) && (!current || time > Date.parse(current.fetchedAt)) ? candidate : current;
}

export async function chooseImportMode(explicit: string | undefined, io: {
  input: Readable; output: Writable; interactive: boolean;
} = { input: stdin, output: stdout, interactive: Boolean(stdin.isTTY && stdout.isTTY) }): Promise<ImportMode> {
  if (explicit !== undefined) {
    if (explicit !== 'all' && explicit !== 'continue') throw new Error('--mode must be all or continue');
    return explicit;
  }
  // Scheduled commands and pipes must never wait for terminal input or refresh implicitly.
  if (!io.interactive) return 'continue';
  io.output.write('\nChoose an import action:\n  1. Update all — download every selected pair again\n  2. Continue from latest — skip saved pairs and retry gaps (default)\n\n');
  const rl = createInterface({ input: io.input, output: io.output });
  const abort = new AbortController();
  rl.once('SIGINT', () => abort.abort());
  rl.once('close', () => abort.abort());
  try {
    for (;;) {
      const answer = (await rl.question('Select [1/2, Enter = 2]: ', { signal: abort.signal })).trim().toLowerCase();
      if (answer === '1' || answer === 'all') return 'all';
      if (!answer || answer === '2' || answer === 'continue') return 'continue';
      io.output.write('Enter 1 for Update all or 2 for Continue from latest.\n');
    }
  } catch (error) {
    if (abort.signal.aborted) throw new ImportCancelled();
    throw error;
  } finally { rl.close(); }
}
