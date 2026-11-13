import { spawnSync } from 'node:child_process';
import { git, ensureUnchanged, validateGitRef } from './git.mjs';

const HOSTS = new Set(['github', 'gitlab']);
export function validatePublisher(config) {
  if (!config) return null;
  if (!HOSTS.has(config.kind)) throw new Error('Unknown code-host publisher');
  if (typeof config.repository !== 'string' || !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+$/.test(config.repository) ||
      config.repository.includes('..')) throw new Error('Invalid publisher repository');
  return config;
}
function cli(binary, args, cwd) {
  const r = spawnSync(binary, args, {
    cwd, encoding: 'utf8', timeout: 40_000, maxBuffer: 120_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (r.error || r.status !== 0) throw new Error('Host CLI ' + binary + ' failed');
  return r.stdout.trim();
}
export function createDraftChange({
  publisher, workspace, source, ref, expectedSha, title, message, id,
}) {
  const plugin = validatePublisher(publisher);
  if (!plugin) throw new Error('No code-host publisher configured');
  ensureUnchanged({ source, ref, expected: expectedSha });
  const branch = validateGitRef('agent/harness-' + id);
  const authorName = publisher.gitAuthorName || 'Portable Harness Agent';
  const authorEmail = publisher.gitAuthorEmail || 'portable-harness@example.invalid';
  const coAuthorEmail = publisher.gitCoAuthorEmail || authorEmail;
  if (!/^[A-Za-z0-9 _.-]{3,90}$/.test(authorName) ||
      !/^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+$/.test(authorEmail) ||
      !/^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+$/.test(coAuthorEmail)) {
    throw new Error('Git author identity must be explicitly safe');
  }
  git(['checkout', '-b', branch], workspace);
  // All tracked and untracked changes are already checked by the runtime before this function.
  git(['add', '--update'], workspace);
  git(['-c', 'user.name=' + authorName, '-c',
    'user.email=' + authorEmail,
    'commit', '-m', title, '-m',
    'Co-authored-by: Portable Harness Agent <' + coAuthorEmail + '>'], workspace);
  git(['push', 'origin', branch], workspace, { timeout: 80_000 });
  const url = plugin.kind === 'github'
    ? cli('gh', ['pr', 'create', '--repo', plugin.repository, '--base', ref,
        '--head', branch, '--draft', '--title', title, '--body', message], workspace)
    : cli('glab', ['mr', 'create', '--repo', plugin.repository, '--target-branch', ref,
        '--source-branch', branch, '--draft', '--title', title, '--description', message, '--yes'], workspace);
  return { provider: plugin.kind, url, branch };
}
