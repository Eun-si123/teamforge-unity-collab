import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allowedFiles, modelsFromEnv, VERIFIED_DEFAULT_MODEL, buildOpenCodeConfig,
  assertInternalDockerNetwork, sandboxArgs, safePatchPaths, INTERNAL_NETWORK,
} from './opencode-core.mjs';
import { parseCodingArgs, classifyModelFailure } from './opencode-runner.mjs';

test('only explicit approved NVIDIA models, default is the verified tiny route', () => {
  assert.deepEqual(modelsFromEnv(''), [VERIFIED_DEFAULT_MODEL]);
  assert.deepEqual(modelsFromEnv('nvidia/minimaxai/minimax-m3.1-flash,nvidia/nvidia/nemotron-3.5-lightning-30b-a3b').length, 2);
  for (const bad of ['openrouter/nvidia/nemotron-3.5-lightning:free', 'auto/best-free',
    'nvidia/minimaxai/minimax-m3.1-flash,nvidia/minimaxai/minimax-m3.1-flash',
    ',nvidia/minimaxai/minimax-m3.1-flash']) assert.throws(() => modelsFromEnv(bad));
});

test('file policy rejects project metadata, credentials and path escapes', () => {
  assert.deepEqual(allowedFiles(['server/app.mjs', 'server/app.mjs']), ['server/app.mjs']);
  for (const bad of ['../secret', '/etc/passwd', '.git/config', '.env', 'src/secret.txt', 'src/../package.json',
    '.github/workflows/ci.yml', 'id_rsa', 'dir//file', 'src\\evil', 'a b.js']) assert.throws(() => allowedFiles([bad]));
  assert.throws(() => allowedFiles([]));
  assert.throws(() => allowedFiles(['a','b','c','d','e','f','g']));
});

test('OpenCode V1 config preserves no-shell/no-network permissions and env-only key', () => {
  const config = buildOpenCodeConfig([VERIFIED_DEFAULT_MODEL], { editing: true });
  assert.deepEqual(config.enabled_providers, ['omniroute-teamforge']);
  assert.equal(config.provider['omniroute-teamforge'].npm, '@ai-sdk/openai-compatible');
  assert.equal(config.provider['omniroute-teamforge'].options.apiKey, '{env:OMNIROUTE_GITHUB_API_KEY}');
  assert.equal(config.permission.bash, 'deny');
  assert.equal(config.permission.read['*.env'], 'deny');
  assert.equal(config.permission.read['*secrets*'], 'deny');
  assert.equal(config.permission.webfetch, 'deny');
  assert.equal(config.permission.task, 'deny');
  assert.equal(config.permission.external_directory, 'deny');
  assert.equal(config.permission.edit['*'], 'deny');
  assert.equal(config.permission.edit['/work/workspace/**'], 'allow');
  assert.equal(buildOpenCodeConfig([VERIFIED_DEFAULT_MODEL], { editing: false }).permission.edit, 'deny');
  assert.equal(JSON.stringify(config).includes('sk-'), false);
});

test('must prove a private, exclusive OmniRoute internal bridge, fail closed', () => {
  const network = [{
    Name: INTERNAL_NETWORK, Driver: 'bridge', Internal: true, EnableIPv6: false,
    Containers: { one: { Name: 'omniroute' } },
  }];
  const gateway = [{
    Name: '/omniroute', State: { Running: true },
    NetworkSettings: { Networks: { [INTERNAL_NETWORK]: {} } },
  }];
  assert.equal(assertInternalDockerNetwork(network, gateway), true);
  assert.throws(() => assertInternalDockerNetwork([{ ...network[0], Internal: false }], gateway));
  assert.throws(() => assertInternalDockerNetwork([{ ...network[0], Containers: { one: { Name: 'omniroute' }, two: { Name: 'other' } } }], gateway));
  assert.throws(() => assertInternalDockerNetwork(network, [{ ...gateway[0], State: { Running: false } }]));
});

test('sandbox has no GitHub keys, shell or unmanaged network access; clone-only workspace', () => {
  const options = {
    name: 'tf-nv-12345678', workspace: '/tmp/disposable/workspace',
    configPath: '/tmp/disposable/opencode.json',
    binaryPath: '/home/eun/.local/bin/opencode',
    model: VERIFIED_DEFAULT_MODEL, prompt: 'bounded', editing: true,
  };
  const args = sandboxArgs(options);
  const rendered = args.join(' ');
  for (const required of ['--read-only', '--cap-drop=ALL', '--pids-limit=128', '--network ' + INTERNAL_NETWORK,
    'OMNIROUTE_GITHUB_API_KEY', 'teamforge-harness', '--pure']) assert.ok(rendered.includes(required), required);
  assert.ok(rendered.includes('OPENCODE_CONFIG_CONTENT'));
  assert.ok(rendered.includes('OPENCODE_CONFIG=/work/opencode.json'));
  assert.equal(rendered.includes('GITHUB_TOKEN'), false);
  assert.equal(rendered.includes('gh auth'), false);
  assert.equal(rendered.includes('sk-'), false);
  assert.ok(args.includes('/tmp/disposable/workspace:/work/workspace:rw'));
  assert.ok(sandboxArgs({ ...options, editing: false }).includes('/tmp/disposable/workspace:/work/workspace:ro'));
  assert.throws(() => sandboxArgs({ ...options, model: 'openai/gpt-4o' }));
});

test('only modified existing files can pass diff gate', () => {
  assert.deepEqual(safePatchPaths({ names: ['src/a.mjs'], status: ['M\tsrc/a.mjs'], allowed: ['src/a.mjs'] }), ['src/a.mjs']);
  for (const status of ['A\tsrc/a.mjs', 'D\tsrc/a.mjs', 'R100\tsrc/a.mjs']) {
    assert.throws(() => safePatchPaths({ names: ['src/a.mjs'], status: [status], allowed: ['src/a.mjs'] }));
  }
  assert.throws(() => safePatchPaths({ names: ['src/b.mjs'], status: ['M\tsrc/b.mjs'], allowed: ['src/a.mjs'] }));
});

test('CLI is explicit, safe and does not publish by default', () => {
  const plan = parseCodingArgs(['plan', '--issue', '531', '--files', 'server/app.mjs']);
  assert.equal(plan.mode, 'plan');
  assert.equal(plan.publish, false);
  const edit = parseCodingArgs(['develop', '--issue', '531', '--files', 'server/app.mjs', '--test', 'node --test server/app.test.mjs']);
  assert.equal(edit.testFile, 'server/app.test.mjs');
  assert.throws(() => parseCodingArgs(['develop', '--issue', '531', '--files', 'server/app.mjs', '--test', 'npm run validate']));
  assert.throws(() => parseCodingArgs(['develop', '--issue', '531', '--files', 'server/app.test.mjs', '--test', 'node --test server/app.test.mjs']), /Test file cannot be modified/);
  assert.throws(() => parseCodingArgs(['plan', '--issue', '531', '--files', 'server/app.mjs', '--publish']));
  assert.throws(() => parseCodingArgs(['develop', '--repo', 'Eun-si123/BetterNet-private', '--issue', '1', '--files', 'a.js', '--test', 'node --test a.test.js']));
  assert.equal(classifyModelFailure({ stderr: 'HTTP 429' }), 'retryable_model_failure');
  assert.equal(classifyModelFailure({ stderr: 'HTTP 403' }), 'blocked_model_or_key');
});
