import { execFileSync, spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';

const REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,180}$/;
const SHA = /^[a-f0-9]{40}$/;
export function validateGitSource(source) {
  if (typeof source !== 'string' || !source.trim()) throw new Error('Missing git source');
  if (isAbsolute(source)) return realpathSync(source);
  const url = new URL(source);
  if (!['https:', 'ssh:'].includes(url.protocol) || url.password ||
      (url.protocol === 'https:' && url.username) ||
      url.search || url.hash || !url.hostname) throw new Error('Unsafe git source URI');
  return source;
}
export function validateGitRef(ref) {
  if (typeof ref !== 'string' || !REF.test(ref) || ref.includes('..') || ref.includes('//') ||
      ref.endsWith('.') || ref.endsWith('/') || ref.includes('@{') || ref.includes('.lock')) {
    throw new Error('Unsafe git ref');
  }
  return ref;
}
export function git(args, cwd, { timeout = 50_000, check = true, maxBuffer = 2_000_000 } = {}) {
  const result = spawnSync('git', args, {
    cwd, timeout, encoding: 'utf8', maxBuffer,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  if (result.error || result.signal || (result.status !== 0 && check)) {
    // Never echo credentials, remote error bodies or repositories into reports.
    throw new Error('Git operation ' + args[0] + ' failed (' + (result.error?.code || result.status || 'signal') + ')');
  }
  return result.stdout.trim();
}
export function sourceHead(source, ref) {
  validateGitSource(source);
  validateGitRef(ref);
  const s = git(['ls-remote', source, 'refs/heads/' + ref]);
  const sha = s.split(/\s+/)[0];
  if (!SHA.test(sha)) throw new Error('Cannot verify remote head for requested ref');
  return sha;
}
export function clonePinned({ source, ref, target }) {
  validateGitSource(source);
  validateGitRef(ref);
  if (!isAbsolute(target)) throw new Error('Disposable clone target must be absolute');
  const before = sourceHead(source, ref);
  git(['clone', '--depth=1', '--branch', ref, '--', source, target], undefined, { timeout: 120_000 });
  const actual = git(['rev-parse', 'HEAD'], target);
  if (actual !== before) throw new Error('Git source changed during clone');
  return before;
}
export function ensureUnchanged({ source, ref, expected }) {
  if (sourceHead(source, ref) !== expected) throw new Error('Git base advanced, fresh review required');
}
