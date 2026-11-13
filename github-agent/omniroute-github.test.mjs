import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArguments, readJsonReply, responseText, extractPatch, assertRepo, checkPaths } from './omniroute-github.mjs';

test('only explicit valid commands and opt-in publishing are accepted', () => {
  const r = parseArguments(['review', '--repo', 'Eun-si123/teamforge-unity-collab', '--pr', '535']);
  assert.equal(r.publish, false);
  assert.equal(r.pr, '535');
  assert.throws(() => parseArguments(['review', '--repo', 'Eun-si123/repo', '--pr', '0;rm -rf /']), /requires --pr/);
  assert.throws(() => parseArguments(['develop', '--repo', 'Eun-si123/repo', '--issue', '1', '--files', 'src/a.js', '--publish']), /requires --test/);
  assert.throws(() => parseArguments(['develop', '--repo', 'Eun-si123/repo', '--issue', '1', '--files', 'src/a.js', '--test', 'rm -rf /']), /Unsupported/);
});
test('repo and changed-file path constraints are fail-closed', () => {
  assert.equal(assertRepo('Eun-si123/For-OmniRoute'), 'Eun-si123/For-OmniRoute');
  for (const bad of ['../repo', 'owner/repo/other', 'owner/repo..', '']) assert.throws(() => assertRepo(bad));
  for (const bad of ['/etc/passwd', '../secrets.txt', 'dir/../../other.js', '.env', 'sub/id_rsa', 'x\\y.js', 'a//b.js']) assert.throws(() => checkPaths([bad]));
});
test('strict JSON advisory parser strips fences, bounds fields and ignores malformed entries', () => {
  const r = readJsonReply('```json\n{"summary":"check","findings":[{"path":"server/index.mjs","line":14,"severity":"high","evidence":"stale value","risk":"bad write","fix":"validate revision"},{"path":"","risk":"x"}]}\n```');
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].severity, 'high');
  assert.equal(r.findings[0].line, 14);
  assert.throws(() => readJsonReply('{"summary":"no findings"}'), /findings/);
  assert.equal(responseText({choices:[{message:{content:[{text:'hello'}]}}]}), 'hello');
});
test('patch allowlist rejects file creation, traversal, rename, binary, or extra paths', () => {
  const valid='diff --git a/server/app.mjs b/server/app.mjs\n--- a/server/app.mjs\n+++ b/server/app.mjs\n@@ -1 +1 @@\n-old\n+new\n';
  assert.equal(extractPatch(valid, ['server/app.mjs']), valid);
  assert.throws(() => extractPatch(valid, ['server/test.mjs']), /non-allowlisted/);
  assert.throws(() => extractPatch(valid.replaceAll('server/app.mjs','../secret'), ['server/app.mjs']), /non-allowlisted/);
  assert.throws(() => extractPatch(valid + 'new file mode 100644', ['server/app.mjs']), /new\/deleted/);
  assert.throws(() => extractPatch('NO_PATCH', ['server/app.mjs']), /Missing/);
});
