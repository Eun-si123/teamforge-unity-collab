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
}

console.log(`GitHub Actions policy passed for ${workflowNames.length} workflow(s).`);
