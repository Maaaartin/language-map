export interface QueueProgress {
  total: number;
  pending: number;
  active: number;
  attempted: number;
  succeeded: number;
  failed: number;
}

// Only worker promises are created, never one promise per queued comparison.
export async function runQueue<T>(jobs: readonly T[], options: {
  concurrency: number;
  limit: number;
  shouldStop: () => boolean;
  process: (job: T) => Promise<void>;
  onError: (error: unknown, job: T) => Promise<void>;
  onProgress?: (progress: QueueProgress) => Promise<void>;
}): Promise<QueueProgress> {
  const { concurrency, limit } = options;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new Error('Invalid queue concurrency');
  if (limit !== Infinity && (!Number.isSafeInteger(limit) || limit < 0)) throw new Error('Invalid queue limit');
  const state: QueueProgress = { total: jobs.length, pending: jobs.length, active: 0, attempted: 0, succeeded: 0, failed: 0 };
  let fatal: unknown;
  let hasFatal = false;
  // Serialize progress writes so checkpoints cannot overwrite newer progress.
  let reporting = Promise.resolve();
  const worker = async () => {
    while (!hasFatal && !options.shouldStop() && state.attempted < Math.min(limit, jobs.length)) {
      const job = jobs[state.attempted++];
      state.pending--; state.active++;
      try { await options.process(job); state.succeeded++; }
      catch (error) {
        state.failed++;
        try { await options.onError(error, job); }
        catch (error) { fatal = error; hasFatal = true; }
      } finally { state.active--; }
      // Snapshot at write time, after previous writers have finished.
      reporting = reporting.then(() => options.onProgress?.({ ...state }));
      try { await reporting; }
      catch (error) { fatal = error; hasFatal = true; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length, limit) }, worker));
  if (hasFatal) throw fatal;
  return { ...state };
}
