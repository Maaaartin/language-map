import { spawnSync } from 'node:child_process';
import { access, mkdtemp, rename, rm, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const archive = 'comparisons.tar.gz';

function gh(args, capture = false) {
  const result = spawnSync('gh', args, { encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
  if (result.error) {
    throw new Error(result.error.code === 'ENOENT'
      ? 'GitHub CLI is required. Install it with brew install gh, then run gh auth login.'
      : result.error.message);
  }
  return result;
}

function requireSuccess(result, message) {
  if (result.status !== 0) throw new Error(`${message}${result.stderr?.trim() ? `: ${result.stderr.trim()}` : ''}`);
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    repo: { type: 'string', default: 'Maaaartin/language-map' },
    tag: { type: 'string', default: 'comparison-data-v1' },
  } });
  const [action] = positionals;
  if (positionals.length !== 1 || !['upload', 'download'].includes(action)) {
    throw new Error('Usage: node scripts/comparison-release.mjs upload|download [--repo OWNER/REPO] [--tag TAG]');
  }
  const repo = values.repo, tag = values.tag;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !tag || tag.startsWith('-')) {
    throw new Error('Provide a valid OWNER/REPO and release tag.');
  }

  if (action === 'upload') {
    try {
      await access(archive, constants.R_OK);
      if (!(await stat(archive)).isFile()) throw new Error('Expected a regular file');
    } catch {
      throw new Error(`Cannot read ${archive}. Run npm run compress:comparisons first.`);
    }
  }
  requireSuccess(gh(['auth', 'status'], true), 'GitHub authentication failed. Run gh auth login');

  if (action === 'upload') {
    const release = gh(['api', `repos/${repo}/releases/tags/${encodeURIComponent(tag)}`], true);
    if (release.status === 0) {
      // Refuse duplicate assets rather than deleting a previous upload before replacement succeeds.
      requireSuccess(gh(['release', 'upload', tag, archive, '--repo', repo]), 'Archive upload failed');
    } else if (/\(HTTP 404\)/.test(release.stderr)) {
      requireSuccess(gh(['release', 'create', tag, archive, '--repo', repo, '--target', 'main',
        '--title', 'Comparison data', '--notes', 'Compressed comparison dataset.']), 'Release creation failed');
    } else {
      requireSuccess(release, 'Could not check the release');
    }
    console.log(`Uploaded ${archive} to ${repo}, release ${tag}.`);
  } else {
    // Download beside the destination so a failed download leaves the existing archive untouched.
    const temporary = await mkdtemp('.comparison-download-');
    try {
      requireSuccess(gh(['release', 'download', tag, '--repo', repo, '--pattern', archive,
        '--dir', temporary]), 'Archive download failed');
      await rename(join(temporary, archive), archive);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
    console.log(`Downloaded ${archive}. Run npm run decompress:comparisons to extract it.`);
  }
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
