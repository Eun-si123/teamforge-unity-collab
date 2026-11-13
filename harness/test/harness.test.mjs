import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runAgent } from '../core/engine.mjs';
import { createModelRouter, validateModelConfig, toAnthropic, normalizeAnthropicResponse } from '../core/providers.mjs';
import { Workspace, safePath, workspaceTools, selectedFiles, normalizeVerification } from '../core/workspace.mjs';
import { validateGitSource, validateGitRef, clonePinned, sourceHead } from '../adapters/git.mjs';
import { assertPublisherMatchesSource } from '../adapters/publishers.mjs';
import { parseArgs, main } from '../cli.mjs';

const MODEL = {
  protocol: 'openai-compatible', id: 'open-model',
  baseUrl: 'http://127.0.0.1:2000/v1', apiKeyEnv: 'DEMO_TEST_KEY',
  approved: true,
};
const OTHER = {
  protocol: 'anthropic-messages', id: 'provider-neutral-claude',
  baseUrl: 'https://api.example.test', apiKeyEnv: 'SECOND_TEST_KEY',
  approved: true,
};
const ENV = { DEMO_TEST_KEY: 'only-for-test', SECOND_TEST_KEY: 'other-test-key' };
const defs = [{
  type: 'function',
  function: { name: 'check', description: 'Read a value', parameters: {
    type: 'object', properties: { x: { type: 'integer' } },
    required: ['x'], additionalProperties: false,
  }},
  execute: async x => ({ ok: true, value: x.x + 1 }),
}];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'portable-harness-test-'));
  execFileSync('git', ['init', '-q', '-b', 'main', root]);
  mkdirSync(join(root, 'src')); mkdirSync(join(root, 'test'));
  writeFileSync(join(root, 'src', 'value.mjs'), 'export const value = 1;\n');
  writeFileSync(join(root, 'test', 'value.test.mjs'),
    "import { value } from '../src/value.mjs';\nimport { strict as assert } from 'node:assert';\nassert.ok(value > 0);\n");
  writeFileSync(join(root, '.env'), 'PASSWORD=not-a-real-secret\n');
  execFileSync('git', ['-C', root, 'add', '--', '.']);
  execFileSync('git', ['-C', root, '-c', 'user.name=Test User', '-c',
    'user.email=test@example.invalid', 'commit', '-qm', 'test fixture']);
  return root;
}

test('provider model and host are configurable, not hardcoded to one vendor', () => {
  assert.equal(validateModelConfig({ models: [MODEL, OTHER] }, ENV).length, 2);
  assert.throws(() => validateModelConfig({ models: [{ ...MODEL, approved: false }] }, ENV), /approval/);
  assert.throws(() => validateModelConfig({ models: [{ ...MODEL, baseUrl: 'http://remote.example/v1' }] }, ENV), /HTTPS/);
  assert.throws(() => validateModelConfig({ models: [{ ...MODEL, baseUrl: 'https://user:pass@api.example/v1' }] }, ENV));
  assert.throws(() => validateModelConfig({ models: [MODEL, MODEL] }, ENV), /duplicate/i);
  // Two connections to the same model, each with its own scoped account,
  // must be accepted and independently rotated.
  const sameModelDifferentAccount = { ...MODEL, apiKeyEnv: 'SECOND_TEST_KEY' };
  assert.equal(validateModelConfig({ models: [MODEL, sameModelDifferentAccount] }, ENV).length, 2);
});

test('OpenAI-compatible tool calling works across multiple agent turns', async () => {
  const seen = [];
  let count = 0;
  const fetchImpl = async (_url, opts) => {
    const message = JSON.parse(opts.body).messages;
    seen.push(message);
    const value = ++count === 1
      ? { role: 'assistant', content: null, tool_calls: [{ id: 'call_1',
          type: 'function', function: { name: 'check', arguments: '{"x":2}' } }] }
      : { role: 'assistant', content: '3' };
    return new Response(JSON.stringify({ choices: [{ message: value }] }), { status: 200 });
  };
  const router = createModelRouter({ models: [MODEL] }, { env: ENV, fetchImpl });
  const done = await runAgent({
    instruction: 'Use tools', task: 'check 2', tools: defs,
    complete: router.complete,
  });
  assert.equal(done.final, '3');
  assert.equal(done.calls, 1);
  assert.equal(done.turns, 2);
  assert.equal(done.model, 'open-model');
  assert.equal(seen[1].at(-1).role, 'tool');
  assert.equal(JSON.parse(seen[1].at(-1).content).value, 3);
  assert.deepEqual(done.transcript.map(x => x.tool), ['check']);
});

test('a 429 route falls back to a different API protocol and cools down', async () => {
  let now = 1000;
  const seen = [];
  const fetchImpl = async (url, opts) => {
    seen.push(url.toString());
    if (url.toString().includes('127.0.0.1')) return new Response('', { status: 429 });
    assert.equal(opts.headers['x-api-key'], ENV.SECOND_TEST_KEY);
    const body = JSON.parse(opts.body);
    assert.equal(body.model, OTHER.id);
    return new Response(JSON.stringify({ content: [{ type: 'text', text: 'fallback OK' }] }), { status: 200 });
  };
  const router = createModelRouter({ models: [MODEL, OTHER] }, { env: ENV, fetchImpl, now: () => now });
  const result = await router.complete([{ role: 'user', content: 'hello' }], defs);
  assert.equal(result.message.content, 'fallback OK');
  assert.equal(result.model, OTHER.id);
  const again = await router.complete([{ role: 'user', content: 'hello' }], defs);
  assert.equal(again.model, OTHER.id);
  assert.equal(seen.filter(x => x.includes('127.0.0.1')).length, 1);
  now += 121000;
  await router.complete([{ role: 'user', content: 'hello' }], defs);
  assert.equal(seen.filter(x => x.includes('127.0.0.1')).length, 2);
});

test('Anthropic translation preserves tool IDs and command schema', () => {
  const message = toAnthropic([
    { role: 'system', content: 'trusted' },
    { role: 'user', content: 'read' },
    { role: 'assistant', content: null, tool_calls: [{
      id: 'toolu_123', type: 'function', function: { name: 'check', arguments: '{"x":1}' },
    }]},
    { role: 'tool', tool_call_id: 'toolu_123', content: '{"ok":true}' },
  ], defs);
  assert.equal(message.system, 'trusted');
  assert.equal(message.messages.at(-1).content[0].tool_use_id, 'toolu_123');
  const output = normalizeAnthropicResponse({ content: [{
    type: 'tool_use', id: 'toolu_123', name: 'check', input: { x: 1 },
  }]});
  assert.equal(JSON.parse(output.tool_calls[0].function.arguments).x, 1);
});

test('agent refuses unknown/malformed tools and infinite tool loops', async () => {
  let callCounter = 0;
  const always = async () => ({ model: 'fake', message: {
    role: 'assistant', content: null, tool_calls: [
      { id: 'tool_' + (++callCounter), type: 'function', function: { name: 'unknown', arguments: '{}' } },
    ],
  }});
  await assert.rejects(() => runAgent({
    instruction: 'test', task: 'test', tools: defs, complete: always,
    maxTurns: 2,
  }), /turn limit/);
  await assert.rejects(() => runAgent({
    instruction: 'test', task: 'test', tools: defs, complete: async () => ({
      model: 'fake', message: { role: 'assistant', content: null, tool_calls: [
        { id: 'x', type: 'function', function: { name: 'check', arguments: '{invalid' } },
      ]},
    }),
  }), /JSON/);
});

test('verification supports configurable language/runtime without shell or model control', () => {
  const dotnet = normalizeVerification({
    image: 'mcr.microsoft.com/dotnet/sdk:8.0',
    command: ['dotnet', 'test', 'Example.csproj', '--no-restore'],
    expectedText: 'Passed!',
    timeoutMs: 180000,
  }, 'Tests/ExampleTests.cs');
  assert.equal(dotnet.command[0], 'dotnet');
  assert.equal(dotnet.image, 'mcr.microsoft.com/dotnet/sdk:8.0');
  assert.throws(() => normalizeVerification({
    ...dotnet, command: ['bash', '-c', 'echo done'],
  }, 'Tests/ExampleTests.cs'), /Shell/);
  assert.throws(() => normalizeVerification({
    ...dotnet, command: ['dotnet', 'test', 'x' + String.fromCharCode(10), '--no-restore'],
  }, 'Tests/ExampleTests.cs'));
  assert.throws(() => normalizeVerification({
    ...dotnet, expectedText: 'x',
  }, 'Tests/ExampleTests.cs'));
});

test('file tools are path-scoped and patch-only, never direct file writes or shell', () => {
  const root = fixture();
  try {
    const ws = new Workspace({ root, files: ['src/value.mjs'], testFile: 'test/value.test.mjs' });
    assert.equal(ws.readFile({ path: 'src/value.mjs' }).content, 'export const value = 1;\n');
    assert.throws(() => ws.readFile({ path: '.env' }));
    assert.throws(() => ws.readFile({ path: '../secrets' }));
    assert.throws(() => selectedFiles(['.github/workflows/check.yml']));
    assert.deepEqual(workspaceTools(ws, 'review').map(x => x.function.name), ['list_files', 'read_file', 'search_text']);
    const editNames = workspaceTools(ws, 'develop').map(x => x.function.name);
    assert.deepEqual(editNames, ['list_files', 'read_file', 'search_text', 'apply_patch', 'run_tests']);
    const patch = 'diff --git a/src/value.mjs b/src/value.mjs\n' +
      '--- a/src/value.mjs\n+++ b/src/value.mjs\n@@ -1 +1 @@\n' +
      '-export const value = 1;\n+export const value = 2;\n';
    assert.equal(ws.applyPatch({ patch }).ok, true);
    assert.deepEqual(ws.changedPaths(), ['src/value.mjs']);
    assert.throws(() => ws.applyPatch({
      patch: patch.replaceAll('src/value.mjs', 'test/value.test.mjs'),
    }), /Out-of-scope/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('git adapter works for non-GitHub local repo and pins head', () => {
  const root = fixture(), target = join(tmpdir(), 'portable-harness-clone-' + Date.now());
  try {
    assert.equal(validateGitSource(root), root);
    assert.equal(validateGitRef('main'), 'main');
    assert.throws(() => validateGitSource('https://token:password@git.example.com/foo'));
    assert.throws(() => validateGitRef('../main'));
    const sha = sourceHead(root, 'main');
    assert.equal(sha.length, 40);
    assert.equal(clonePinned({ source: root, ref: 'main', target }), sha);
  } finally {
    rmSync(target, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI plan works without provider secrets or GitHub credentials', async () => {
  const root = fixture();
  try {
    const cfg = join(root, 'models.json');
    writeFileSync(cfg, JSON.stringify({ models: [MODEL] }));
    const task = join(root, 'task.txt');
    writeFileSync(task, 'Improve value test coverage');
    const args = ['plan', '--config', cfg, '--source', root,
      '--ref', 'main', '--task-file', task, '--files', 'src/value.mjs'];
    assert.equal(parseArgs(args).mode, 'plan');
    assert.equal((await main(args)).status, 'PLAN_ONLY');
    assert.throws(() => parseArgs([...args, '--publish']));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('independent accounts serving one model use separate cooldowns', async () => {
  const second = { ...MODEL, apiKeyEnv: 'SECOND_TEST_KEY' };
  const calls = [];
  let now = 1000;
  const router = createModelRouter({ models: [MODEL, second] }, {
    env: ENV, now: () => now,
    fetchImpl: async (_url, options) => {
      const key = options.headers.Authorization;
      calls.push(key);
      if (key === 'Bearer only-for-test') return new Response('', { status: 429 });
      return new Response(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'other account OK' } }],
      }), { status: 200 });
    },
  });
  assert.equal((await router.complete([{ role: 'user', content: 'hi' }], defs)).message.content, 'other account OK');
  assert.equal((await router.complete([{ role: 'user', content: 'hi' }], defs)).message.content, 'other account OK');
  assert.deepEqual(calls, ['Bearer only-for-test', 'Bearer other-test-key', 'Bearer other-test-key']);
  now += 121000;
  await router.complete([{ role: 'user', content: 'hi' }], defs);
  assert.equal(calls.filter(x => x === 'Bearer only-for-test').length, 2);
});

test('native Anthropic Messages tool use round-trips through the same agent engine', async () => {
  let rounds = 0;
  const fetchImpl = async (url, options) => {
    assert.equal(url, 'https://api.example.test/v1/messages');
    const req = JSON.parse(options.body);
    rounds++;
    if (rounds === 1) {
      assert.equal(req.tools[0].name, 'check');
      return new Response(JSON.stringify({ content: [
        { type: 'tool_use', id: 'toolu_native_1', name: 'check', input: { x: 4 } },
      ]}), { status: 200 });
    }
    assert.equal(req.messages.at(-1).content[0].type, 'tool_result');
    assert.equal(req.messages.at(-1).content[0].tool_use_id, 'toolu_native_1');
    return new Response(JSON.stringify({ content: [{ type: 'text', text: '5' }] }), { status: 200 });
  };
  const router = createModelRouter({ models: [OTHER] }, { env: ENV, fetchImpl });
  const result = await runAgent({
    instruction: 'Use a tool', task: 'check 4', complete: router.complete, tools: defs,
  });
  assert.equal(result.final, '5');
  assert.equal(result.calls, 1);
  assert.equal(result.model, OTHER.id);
  assert.equal(rounds, 2);
});

test('no model invocation without explicit source-disclosure approval', async () => {
  const repo = fixture();
  try {
    const config = join(repo, 'harness-config.json'), task = join(repo, 'task.txt');
    writeFileSync(config, JSON.stringify({ models: [MODEL], sourceDisclosureApproved: false }));
    writeFileSync(task, 'Inspect code without permission');
    await assert.rejects(() => main([
      'review', '--config', config, '--source', repo, '--ref', 'main',
      '--task-file', task, '--files', 'src/value.mjs',
    ]), /sourceDisclosureApproved=true/);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('draft publication refuses local sources, host mismatch and repository confusion', () => {
  const pub = { kind: 'github', repository: 'company/toolkit' };
  assert.equal(assertPublisherMatchesSource('https://github.com/company/toolkit.git', pub), true);
  assert.equal(assertPublisherMatchesSource('ssh://git@github.com/company/toolkit.git', pub), true);
  for (const source of [
    '/tmp/some-local-repo',
    'https://github.com/company/other.git',
    'https://github.com.evil.example/company/toolkit.git',
    'https://gitlab.com/company/toolkit.git',
    'https://github.com/company/toolkit%2fevil.git',
  ]) {
    assert.throws(() => assertPublisherMatchesSource(source, pub));
  }
  assert.equal(assertPublisherMatchesSource('https://gitlab.example.org/acme/group/tool.git',
    { kind: 'gitlab', host: 'gitlab.example.org', repository: 'acme/group/tool' }), true);
});
