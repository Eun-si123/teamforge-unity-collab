import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflowDir = join(root, ".github", "workflows");

const workflowNames = (await readdir(workflowDir))
  .filter((name) => /\.ya?ml$/u.test(name))
  .sort();

assert(workflowNames.length > 0, "Repository must contain at least one GitHub Actions workflow.");

const shaPinnedAction = /^[^@\s]+@[0-9a-f]{40}$/iu;
const digestPinnedDockerAction = /^docker:\/\/[^\s@]+@sha256:[0-9a-f]{64}$/iu;

function assertJobTimeouts(text, relativePath) {
  const lines = text.split(/\r?\n/u);
  let inJobs = false;
  let currentJob = null;

  const finishJob = () => {
    if (currentJob?.hasRunsOn) {
      assert(currentJob.hasTimeout,
        `${relativePath} job ${currentJob.name} must declare timeout-minutes.`);
    }
  };

  for (const line of lines) {
    if (/^jobs:\s*(?:#.*)?$/u.test(line)) {
      inJobs = true;
      continue;
    }
    if (!inJobs) continue;

    if (/^[^\s]/u.test(line)) {
      finishJob();
      currentJob = null;
      inJobs = false;
      continue;
    }

    const jobMatch = /^  ([A-Za-z_][A-Za-z0-9_.-]*):\s*(?:#.*)?$/u.exec(line);
    if (jobMatch) {
      finishJob();
      currentJob = { name: jobMatch[1], hasRunsOn: false, hasTimeout: false };
      continue;
    }
    if (!currentJob) continue;

    if (/^    runs-on\s*:/u.test(line)) currentJob.hasRunsOn = true;
    if (/^    timeout-minutes\s*:\s*[1-9][0-9]*\s*(?:#.*)?$/u.test(line)) currentJob.hasTimeout = true;
  }

  finishJob();
}

// GitHub's implicit low-trust default is read-only, but a later workflow
// refactor or an explicit write mode could silently widen that boundary.
// Keep the one intentional write exception scoped to main-branch push only.
export function assertCacheAccessPolicy(source, relativePath) {
  const text = source.split(/\r?\n/u)
    .filter(line => !/^\s*#/u.test(line)).join("\n");
  const topLevel = [...text.matchAll(/^cache-mode:\s*(.*?)\s*$/gmu)]
    .map(match => match[1]);
  const jobModes = [...text.matchAll(/^ {4}cache-mode:\s*(.*?)\s*$/gmu)]
    .map(match => match[1]);
  const trustedPushRule = "\${{ github.event_name == 'push' && 'write' || 'read' }}";
  assert(topLevel.length <= 1, \`\${relativePath} must not declare multiple workflow cache modes.\`);
  for (const mode of jobModes) {
    assert(["read", "none"].includes(mode),
      \`\${relativePath} job-level cache overrides must not grant cache write access.\`);
  }
  const hasCache = /^\s+cache:\s*npm\s*$/mu.test(text);
  if (hasCache) {
    assert(topLevel[0] === trustedPushRule,
      \`\${relativePath} npm caching must allow write only on trusted main pushes.\`);
    const eventSection = text.split(/^jobs:\s*$/mu, 1)[0];
    assert(/^  push:\s*$/mu.test(eventSection) &&
      /^    branches:\s*\[main\]\s*$/mu.test(eventSection),
      \`\${relativePath} the trusted cache-write rule requires push restricted to main.\`);
  } else if (topLevel.length > 0) {
    assert(["read", "none"].includes(topLevel[0]),
      \`\${relativePath} workflows without npm cache must not grant cache writes.\`);
  }
}

for (const name of workflowNames) {
  const relativePath = `.github/workflows/${name}`;
  const text = await readFile(join(workflowDir, name), "utf8");

  assert.match(
    text,
    /^permissions:\s*(?:\{\s*\})?\s*(?:#.*)?$/mu,
    `${relativePath} must declare explicit top-level permissions.`,
  );
  assert(!/^(?:permissions| {4}permissions):\s*write-all\s*(?:#.*)?$/mu.test(text),
    `${relativePath} must not grant write-all permissions.`);

  const eventSection = text.split(/^jobs:\s*$/mu, 1)[0];
  const unsafeTrigger = eventSection
    .split(/\r?\n/u)
    .map((line) => line.replace(/#.*$/u, ""))
    .some((line) => /\bpull_request_target\b/u.test(line));
  assert(!unsafeTrigger,
    `${relativePath} must not use pull_request_target without an explicit security review and validator update.`);

  for (const match of text.matchAll(/^(?: {4}| {8})uses:\s*([^\s#]+)(?:\s+#.*)?$/gmu)) {
    const action = match[1];
    if (action.startsWith("./")) continue;

    assert(
      shaPinnedAction.test(action) || digestPinnedDockerAction.test(action),
      `${relativePath} uses a mutable external action reference: ${action}. Pin external actions to a full commit SHA or Docker digest.`,
    );
  }

  assertJobTimeouts(text, relativePath);
  assertCacheAccessPolicy(text, relativePath);
}

console.log(`GitHub Actions policy passed for ${workflowNames.length} workflow(s).`);
