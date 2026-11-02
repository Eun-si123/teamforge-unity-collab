import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { resolveTestLabCommand } from "./test-lab-command.mjs";

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "teamforge-npm-command-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function cli(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "This resolver fixture must never be executed.");
  return file;
}

test("Windows npm uses the validated explicit CLI and preserves argument boundaries", (t) => {
  const directory = fixture(t);
  const npmCli = cli(path.join(directory, "npm installation with spaces", "npm-cli.js"));
  const nodeExecutable = path.join(directory, "node", "node.exe");
  const args = ["run", "test", "--", "spaces stay together", "a&b", "$(unexpanded)", 'quote"literal'];
  for (const command of ["npm", "NPM", "npm.cmd"]) {
    assert.deepEqual(resolveTestLabCommand(command, args, {
      platform: "win32", nodeExecutable, env: { npm_execpath: npmCli, PATH: "" },
    }), { command: nodeExecutable, args: [npmCli, ...args] });
  }
});

test("invalid explicit CLIs fall back to the standard current Node npm installation", (t) => {
  const directory = fixture(t);
  const nodeExecutable = path.join(directory, "node", "node.exe");
  const standard = cli(path.join(path.dirname(nodeExecutable), "node_modules", "npm", "bin", "npm-cli.js"));
  const wrong = cli(path.join(directory, "npx-cli.js"));
  const shim = cli(path.join(directory, "npm.cmd"));
  const notAFile = path.join(directory, "directory", "npm-cli.js");
  fs.mkdirSync(notAFile, { recursive: true });
  for (const npm_execpath of ["relative/npm-cli.js", wrong, shim, notAFile, path.join(directory, "missing", "npm-cli.js")]) {
    assert.deepEqual(resolveTestLabCommand("npm", ["--version"], {
      platform: "win32", nodeExecutable, env: { npm_execpath, PATH: "" },
    }).args, [standard, "--version"]);
  }
});

test("Windows PATH npm installation and Node lib layout are discovered without running shims", (t) => {
  const directory = fixture(t);
  const nodeExecutable = path.join(directory, "node", "bin", "node.exe");
  const prefix = path.join(directory, "global npm prefix");
  const npmCli = cli(path.join(prefix, "node_modules", "npm", "bin", "npm-cli.js"));
  assert.equal(resolveTestLabCommand("npm", [], {
    platform: "win32", nodeExecutable, env: { Path: prefix },
  }).args[0], npmCli);
  const nodeCli = cli(path.join(directory, "node", "lib", "node_modules", "npm", "bin", "npm-cli.js"));
  assert.equal(resolveTestLabCommand("npm", [], {
    platform: "win32", nodeExecutable, env: { PATH: "" },
  }).args[0], nodeCli);
});

test("missing npm CLI fails closed while ordinary commands and non-Windows npm retain their arguments", (t) => {
  const directory = fixture(t);
  const nodeExecutable = path.join(directory, "missing-node", "node.exe");
  assert.throws(() => resolveTestLabCommand("npm", [], { platform: "win32", nodeExecutable, env: { PATH: "" } }),
    { code: "testlab_npm_cli_unavailable" });
  const args = ["--literal", "a&b"];
  for (const [platform, command] of [["linux", "npm"], ["darwin", "npm"], ["win32", "custom-command"]]) {
    assert.deepEqual(resolveTestLabCommand(command, args, { platform, env: {} }), { command, args });
  }
});
