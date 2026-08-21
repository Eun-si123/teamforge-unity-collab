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

for (const name of workflowNames) {
  const relativePath = `.github/workflows/${name}`;
  const text = await readFile(join(workflowDir, name), "utf8");

  assert.match(
    text,
    /^permissions:\s*(?:\{\s*\})?\s*(?:#.*)?$/mu,
    `${relativePath} must declare explicit top-level permissions.`,
  );
  assert(!/^permissions:\s*write-all\s*$/mu.test(text),
    `${relativePath} must not grant write-all permissions.`);
  assert(!/^\s*pull_request_target\s*:/mu.test(text),
    `${relativePath} must not use pull_request_target without an explicit security review and validator update.`);

  for (const match of text.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gmu)) {
    const action = match[1];
    if (action.startsWith("./")) continue;

    assert(
      shaPinnedAction.test(action) || digestPinnedDockerAction.test(action),
      `${relativePath} uses a mutable external action reference: ${action}. Pin external actions to a full commit SHA or Docker digest.`,
    );
  }
}

console.log(`GitHub Actions policy passed for ${workflowNames.length} workflow(s).`);
