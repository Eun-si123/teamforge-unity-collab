import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execute = promisify(execFile);
const validator = await readFile(new URL('./validate-published-candidate.mjs', import.meta.url), 'utf8');
const candidate = JSON.parse(await readFile(new URL('../builds/published-candidate.json', import.meta.url), 'utf8'));
const fields = [candidate.productVersion, candidate.releaseIdentity, candidate.tag, candidate.sourceCommit, candidate.filename, candidate.sha256];
const ordinal = /-(r\d+)$/u.exec(candidate.tag)?.[1];
const summary = fields.map((value) => '- ' + value).join('\n');
const localized = '# Status\n\n## Overview\n' + summary.replace('- ' + candidate.sourceCommit, '- ' + ordinal + ' Source commit: ' + candidate.sourceCommit) + '\n\n## Historical evidence\nOriginal r5/r6/r7 evidence remains historical.\n\n## Field\n1. Test exact ' + ordinal + ' on both PCs.\n2. Preserve r5/r6/r7 historical results.\n';

async function runFixture(text) {
  const root = await mkdtemp(path.join(tmpdir(), 'teamforge-candidate-validator-'));
  try {
    for (const dir of ['scripts', 'builds', 'docs', 'site/i18n']) await mkdir(path.join(root, dir), { recursive: true });
    const files = {
      'scripts/validate-published-candidate.mjs': validator,
      'builds/published-candidate.json': JSON.stringify(candidate),
      'builds/README.md': '# Builds\n\n## Current published candidate\n' + summary,
      'docs/STATUS.md': '# Status\n\n## Current state at a glance\n' + summary,
      'docs/STATUS.xx.md': text,
      'site/i18n/locales.json': JSON.stringify({locales: [
        {code: 'en'},
        {code: 'xx', documents: {'status/': {repoSource: 'docs/STATUS.xx.md'}}},
        {code: 'unpublished', publish: false, documents: {'status/': {repoSource: 'docs/not-published.md'}}},
      ]}),
    };
    for (const [file, content] of Object.entries(files)) await writeFile(path.join(root, file), content);
    return await execute(process.execPath, [path.join(root, 'scripts/validate-published-candidate.mjs')], {timeout: 10_000});
  } finally {
    await rm(root, {recursive: true, force: true});
  }
}

test('localized current identity passes while older historical evidence and unpublished locales remain valid', async () => {
  const result = await runFixture(localized);
  assert.match(result.stdout, /Localized published-candidate summaries agree: 1/);
});

test('localized overview cannot reuse a superseded artifact hash', async () => {
  await assert.rejects(runFixture(localized.replace(candidate.sha256, '0'.repeat(64))), (error) => {
    assert.match(error.stderr, /current overview is stale: missing published-candidate SHA-256/);
    return true;
  });
});

test('localized source commit cannot carry a different candidate label', async () => {
  await assert.rejects(runFixture(localized.replace(ordinal + ' Source commit', 'r0 Source commit')), (error) => {
    assert.match(error.stderr, /labels the current source commit as a different candidate/);
    return true;
  });
});

test('localized first field task cannot ask for a superseded candidate', async () => {
  await assert.rejects(runFixture(localized.replace('Test exact ' + ordinal, 'Test exact r0')), (error) => {
    assert.match(error.stderr, /asks for a superseded candidate in its first field task/);
    return true;
  });
});
