import { spawnSync } from 'node:child_process';
import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';

const archive = 'comparisons.tar.gz';

try {
  await access(archive, constants.R_OK);
  if (!(await stat(archive)).isFile()) throw new Error('Expected a regular file');
} catch (error) {
  console.error(`Cannot read ${archive}: ${error.message}. Existing JSON files were left untouched.`);
  process.exit(1);
}

// Extract over existing data without deleting JSON files or clearing the directory.
const result = spawnSync('tar', ['-xzf', archive], { stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
