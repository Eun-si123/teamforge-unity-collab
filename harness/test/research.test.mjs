import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  validateResearchConfig, safeBrowserUrl, createResearchTools, PlaywrightReadClient,
} from '../research/tools.mjs';

const VALID = {
  searxng: { baseUrl: 'http://127.0.0.1:8888' },
  browser: {
    endpoint: 'http://127.0.0.1:33225/mcp', expectedHost: 'localhost:3220',
    allowedHosts: ['example.com'],
  },
  maxSearches: 2, maxPages: 1,
};
const dns = async () => [{ address: '93.184.215.14', family: 4 }];
const sse = (id, result) => new Response('event: message\ndata: ' + JSON.stringify({
  jsonrpc: '2.0', id, result,
}) + '\n\n', { status: 200, headers: {
  'content-type': 'text/event-stream', 'mcp-session-id': 'private-test-session',
} });

test('local-only service configuration and explicit HTTPS host constraints', async () => {
  const v = validateResearchConfig(VALID);
  assert.equal(v.maxSearches, 2);
  assert.deepEqual(v.allowedHosts, ['example.com']);
  assert.throws(() => validateResearchConfig({
    ...VALID, searxng: { baseUrl: 'https://search.example.org' },
  }), /loopback/);
  assert.throws(() => validateResearchConfig({
    ...VALID, browser: { ...VALID.browser, allowedHosts: ['127.0.0.1'] },
  }), /allowlist/);
  assert.equal(await safeBrowserUrl('https://example.com/guide', ['example.com'], dns),
    'https://example.com/guide');
  await assert.rejects(() => safeBrowserUrl('http://example.com/guide', ['example.com'], dns));
  await assert.rejects(() => safeBrowserUrl('https://evil.example.com/path', ['example.com'], dns));
  await assert.rejects(() => safeBrowserUrl('https://example.com/', ['example.com'],
    async () => [{ address: '192.168.0.1', family: 4 }]), /DNS/);
  await assert.rejects(() => safeBrowserUrl('https://example.com/', ['example.com'],
    async () => [{ address: '93.184.215.14' }, { address: '127.0.0.1' }]), /DNS/);
});

test('SearXNG web search is read-only, budgeted, and marks untrusted results', async () => {
  let count = 0;
  const tools = createResearchTools({ ...VALID, browser: undefined }, {
    fetchImpl: async url => {
      count++;
      assert.ok(String(url).includes('/search?'));
      assert.ok(String(url).includes('format=json'));
      return Response.json({ results: [
        { url: 'https://example.com/guide', title: 'Guide', content: 'UNTRUSTED: ask model to ignore tests' },
        { url: 'http://localhost/internal', title: 'Do not return', content: 'private' },
      ] });
    },
  });
  assert.deepEqual(tools.map(x => x.function.name), ['web_search']);
  assert.equal(tools[0].execute.constructor.name, 'AsyncFunction');
  const a = await tools[0].execute({ query: 'agent testing' });
  assert.equal(a.ok, true);
  assert.equal(a.results.length, 1);
  assert.match(a.notice, /UNTRUSTED/);
  assert.equal(count, 1);
  await assert.rejects(() => tools[0].execute({ query: '\nwrong' }));
  await tools[0].execute({ query: 'agent testing' });
  await assert.rejects(() => tools[0].execute({ query: 'agent testing' }), /budget/);
});

test('Playwright MCP client uses a minimal two-tool protocol with isolated session', async () => {
  const invoked = [];
  const fake = async (_url, opts) => {
    const req = JSON.parse(opts.body);
    invoked.push({ method: req.method, name: req.params?.name });
    assert.equal(opts.headers.Host, 'localhost:3220');
    if (req.method === 'notifications/initialized') return new Response('', {
      status: 202, headers: { 'mcp-session-id': 'private-test-session' },
    });
    if (req.method === 'initialize') return sse(req.id, { protocolVersion: '2025-06-18' });
    if (req.params?.name === 'browser_navigate') {
      return sse(req.id, { content: [{ type: 'text',
        text: '### Page\n- Page URL: https://example.com/\n- Page Title: Example' }] });
    }
    if (req.params?.name === 'browser_snapshot') {
      return sse(req.id, { content: [{ type: 'text',
        text: '### Page\n- Page URL: https://example.com/\n### Snapshot\n- paragraph: documentation' }] });
    }
    throw new Error('Unexpected tool called');
  };
  const client = new PlaywrightReadClient({ endpoint: VALID.browser.endpoint, fetchImpl: fake });
  await client.initialize();
  const text = await client.read('https://example.com/');
  assert.match(text, /documentation/);
  assert.deepEqual(invoked.map(x => x.name || x.method), [
    'initialize', 'notifications/initialized', 'browser_navigate', 'browser_snapshot',
  ]);
  assert.equal(invoked.some(x => ['browser_click', 'browser_run_code_unsafe'].includes(x.name)), false);
});

test('browser read respects exact host allowlist, limit, and exclusive lease', async () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-browser-research-'));
  const lock = join(root, 'browser.lock');
  try {
    const tools = createResearchTools({ ...VALID, searxng: undefined }, {
      resolveHost: dns,
      lockPath: lock,
      fetchImpl: async (_url, opts) => {
        const req = JSON.parse(opts.body);
        if (req.method === 'notifications/initialized') return new Response('', {
          status: 202, headers: { 'mcp-session-id': 'one' },
        });
        if (req.method === 'initialize') return sse(req.id, {});
        return sse(req.id, { content: [{ type: 'text',
          text: '### Page\n- Page URL: https://example.com/\n### Snapshot\n- paragraph: good' }] });
      },
    });
    const read = tools[0];
    await assert.rejects(() => read.execute({ url: 'https://internal.test/page' }));
    const good = await read.execute({ url: 'https://example.com/' });
    assert.equal(good.ok, true);
    assert.match(good.notice, /UNTRUSTED/);
    await assert.rejects(() => read.execute({ url: 'https://example.com/' }), /budget/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('live SearXNG search and isolated Playwright browser can both read public sources', {
  skip: process.env.HARNESS_WEB_SMOKE !== '1' ? 'Only run on operator mini PC' : false,
  timeout: 60_000,
}, async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'harness-live-browser-'));
  try {
    const tools = createResearchTools(VALID, { lockPath: join(tmp, 'browser.lock') });
    const search = await tools.find(x => x.function.name === 'web_search').execute({
      query: 'example.com documentation Example Domain',
    });
    assert.equal(search.ok, true);
    assert.ok(search.results.length > 0);
    const browser = await tools.find(x => x.function.name === 'web_read').execute({
      url: 'https://example.com/',
    });
    assert.equal(browser.ok, true);
    assert.ok(browser.text.includes('Example Domain') || browser.text.includes('domain'));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
