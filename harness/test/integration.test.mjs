/**
 * Full CLI/tool/patch/isolated-test integration with a deterministic fake LLM.
 * Does not call a paid API, contact GitHub or publish anything.
 * Opt in: HARNESS_INTEGRATION=1 node --test harness/test/integration.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

const enabled = process.env.HARNESS_INTEGRATION === '1';
const cli = resolve(import.meta.dirname, '../cli.mjs');
const repoRoot = resolve(import.meta.dirname, '../..');

test('deterministic model tool calls edit only approved source and pass independent Docker tests', {
  skip: !enabled ? 'Set HARNESS_INTEGRATION=1 and preload node:24-bookworm-slim image' : false,
  timeout: 200_000,
}, async () => {
  const home = mkdtempSync(join(tmpdir(), 'portable-harness-full-'));
  const repo = join(home, 'repo'), state = join(home, 'state');
  mkdirSync(join(repo, 'src'), { recursive: true });
  mkdirSync(join(repo, 'test'));
  mkdirSync(state, { mode: 0o700 });
  writeFileSync(join(repo, 'src', 'math.mjs'),
    'export function add(a, b) {\n  return a - b;\n}\n');
  writeFileSync(join(repo, 'test', 'math.test.mjs'), [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import { add } from '../src/math.mjs';",
    "test('addition correct', () => assert.equal(add(2, 3), 5));",
    '',
  ].join('\n'));
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c',
    'user.email=test@example.invalid', 'commit', '-qm', 'intentionally failing']);
  const patch = [
    'diff --git a/src/math.mjs b/src/math.mjs',
    '--- a/src/math.mjs',
    '+++ b/src/math.mjs',
    '@@ -1,3 +1,3 @@',
    ' export function add(a, b) {',
    '-  return a - b;',
    '+  return a + b;',
    ' }',
    '',
  ].join('\n');
  const steps = [
    { id: 'call_one', name: 'read_file', arguments: { path: 'src/math.mjs' } },
    { id: 'call_two', name: 'read_file', arguments: { path: 'test/math.test.mjs' } },
    { id: 'call_three', name: 'apply_patch', arguments: { patch } },
    { id: 'call_four', name: 'run_tests', arguments: {} },
  ];
  let counter = 0;
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    assert.equal(req.url, '/v1/chat/completions');
    assert.equal(req.headers.authorization, 'Bearer test-fixture-credential');
    assert.ok(body.tools.some(x => x.function?.name === 'read_file'));
    const next = steps[counter++];
    const message = next ? { role: 'assistant', content: null, tool_calls: [{
      id: next.id, type: 'function',
      function: { name: next.name, arguments: JSON.stringify(next.arguments) },
    }]} : { role: 'assistant', content: 'Fixed addition; independent tests must determine correctness.' };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message }] }));
  });
  try {
    await new Promise(ok => server.listen(0, '127.0.0.1', ok));
    const port = server.address().port;
    const config = join(home, 'config.json'), task = join(home, 'task.txt');
    writeFileSync(config, JSON.stringify({ sourceDisclosureApproved: true,
      verification: { image: 'node:24-bookworm-slim',
        command: ['node', '--test', 'test/math.test.mjs'], expectedText: 'tests 1' },
      models: [{
      protocol: 'openai-compatible', baseUrl: 'http://127.0.0.1:' + port + '/v1',
      id: 'fake-model-for-protocol-tests', apiKeyEnv: 'HARNESS_TEST_KEY', approved: true,
    }]}));
    writeFileSync(task, 'Fix add(2,3)=5 without changing test files.');
    const args = [cli, 'develop', '--config', config, '--source', repo,
      '--ref', 'main', '--task-file', task, '--files', 'src/math.mjs',
      '--test-file', 'test/math.test.mjs', '--state-dir', state];
    const env = { ...process.env, HARNESS_TEST_KEY: 'test-fixture-credential' };
    delete env.NODE_OPTIONS;
    const child = spawn(process.execPath, args, { cwd: repoRoot, env });
    const stdout = [], stderr = [];
    child.stdout.on('data', b => stdout.push(b));
    child.stderr.on('data', b => stderr.push(b));
    const code = await new Promise(ok => child.on('close', ok));
    assert.equal(code, 0, Buffer.concat(stderr).toString('utf8'));
    const result = JSON.parse(Buffer.concat(stdout).toString('utf8'));
    assert.equal(result.status, 'PATCH_TESTED');
    assert.equal(result.published, null);
    assert.equal(result.validation, 'isolated_node_tests_pass');
    assert.deepEqual(result.changedFiles, ['src/math.mjs']);
    assert.equal(counter, 5);
    const patchText = readFileSync(result.patchFile, 'utf8');
    assert.ok(patchText.includes('+  return a + b;'));
    // Original repository was never modified.
    assert.ok(readFileSync(join(repo, 'src', 'math.mjs'), 'utf8').includes('return a - b'));
    assert.equal(execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' }), '');
    const checkpoint = JSON.parse(readFileSync(join(state, result.job + '.json'), 'utf8'));
    assert.equal(checkpoint.status, 'PATCH_TESTED');
    assert.equal(readdirSync(state).some(x => x.endsWith('.lock')), false);
  } finally {
    await new Promise(ok => server.close(ok));
    rmSync(home, { recursive: true, force: true });
  }
});
