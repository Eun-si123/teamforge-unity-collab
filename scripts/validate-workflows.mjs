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

// Low-trust workflows already default to read-only cache access. Explicit
// write permissions would bypass that protection, so restrict overrides to
// read/none. Chaos stress does not require cache saves even on trusted pushes.
export function assertCacheAccessPolicy(source, relativePath) {
  const text = source.split(/\r?\n/u)
    .filter(line => !/^\s*#/u.test(line)).join("\n");
  const cacheModes = [...text.matchAll(/^(?:cache-mode| {4}cache-mode):\s*(.*?)\s*$/gmu)]
    .map(match => match[1]);
  for (const mode of cacheModes) {
    assert(["read", "none"].includes(mode),
      `${relativePath} must not explicitly bypass GitHub's low-trust cache-write default.`);
  }
  if (relativePath === ".github/workflows/authority-chaos-stress.yml") {
    assert(/^cache-mode:\s*read\s*$/mu.test(text),
      `${relativePath} must prevent cache saves on every event, including trusted pushes.`);
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
  if (unsafeTrigger) {
    // Reviewed exception: read-only metadata inspection, trusted base checkout only.
    assert.equal(relativePath, ".github/workflows/commit-identity-privacy.yml",
      `${relativePath} must not use pull_request_target without an explicit security review and validator update.`);
    assert.match(text, /^  contents: read$/mu);
    assert.match(text, /^  pull-requests: read$/mu);
    assert.match(text, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/u,
      "Identity audit must checkout a trusted base-branch commit, not PR code.");
    assert.match(text, /persist-credentials: false/u);
    assert.doesNotMatch(text, /github\.event\.pull_request\.head\.(?:sha|ref)/u,
      "Identity audit must never checkout attacker-controlled PR code.");
    assert.match(text, /node scripts\/check-commit-identity\.mjs/u);
  }

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
