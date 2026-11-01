import assert from "node:assert/strict";
import test from "node:test";
import { constants as fsConstants } from "node:fs";
import filesystem, { appendFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { ProjectPeerEngine } from "../src/project-peer.mjs";
import { cleanup, createUnityProject, temporaryRoot } from "./helpers.mjs";

async function fixture() {
  const root = await temporaryRoot("teamforge-version-file-");
  const source = path.join(root, "source");
  await createUnityProject(source);
  return {
    root, source,
    versionPath: path.join(source, "ProjectSettings", "ProjectVersion.txt"),
    engine: new ProjectPeerEngine({ managedRoot: path.join(root, "managed") }),
  };
}

async function resolve(f) {
  return f.engine.resolveSourceProject({ projectRoot: f.source, projectId: "version-guard" });
}

// Each test runs sequentially in this test file's isolated Node worker. Change
// the real builtin operation at one deterministic boundary, then restore it.
async function withVersionOperation(f, name, intercept, operation) {
  const original = filesystem[name];
  let intercepted = false;
  filesystem[name] = async (...args) => {
    const value = await original(...args);
    if (!intercepted && args[0] === f.versionPath) {
      intercepted = true;
      return intercept(value);
    }
    return value;
  };
  syncBuiltinESMExports();
  try {
    await operation();
    assert.equal(intercepted, true, "The actual version reader must reach the selected filesystem boundary.");
  } finally {
    filesystem[name] = original;
    syncBuiltinESMExports();
  }
}

test("Unity ProjectVersion normal source remains accepted", async () => {
  const f = await fixture();
  try {
    assert.equal((await resolve(f)).unityVersion, "6000.3.21f1");
  } finally { await cleanup(f.root); }
});

test("Unity ProjectVersion missing-file diagnostic never reveals the local source path", async () => {
  const f = await fixture();
  try {
    await rm(f.versionPath);
    await assert.rejects(resolve(f), (error) => {
      assert.equal(error.code, "unity_project_version_missing");
      assert.equal(error.message.includes(f.root), false);
      return true;
    });
  } finally { await cleanup(f.root); }
});

test("Unity ProjectVersion refuses oversized content even with a valid first line", async () => {
  const f = await fixture();
  try {
    await writeFile(f.versionPath, `m_EditorVersion: 6000.3.21f1\n${"x".repeat(65_537)}`);
    await assert.rejects(resolve(f), { code: "invalid_unity_version_file" });
  } finally { await cleanup(f.root); }
});

test("Unity ProjectVersion accepts exactly the 64 KiB file budget", async () => {
  const f = await fixture();
  try {
    const firstLine = "m_EditorVersion: 6000.3.21f1\n";
    await writeFile(f.versionPath, firstLine + "x".repeat(65_536 - Buffer.byteLength(firstLine)));
    assert.equal((await resolve(f)).unityVersion, "6000.3.21f1");
  } finally { await cleanup(f.root); }
});

test("Unity ProjectVersion refuses a final-path symbolic link", async (t) => {
  const f = await fixture();
  try {
    const outside = path.join(f.root, "outside.txt");
    await writeFile(outside, "m_EditorVersion: 6000.3.21f1\n");
    await rm(f.versionPath);
    try { await symlink(outside, f.versionPath, "file"); }
    catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) { t.skip("OS does not permit test symlinks"); return; }
      throw error;
    }
    await assert.rejects(resolve(f), { code: "invalid_unity_version_file" });
  } finally { await cleanup(f.root); }
});

test("Unity ProjectVersion rejects an inode replacement between inspection and open", async () => {
  const f = await fixture();
  try {
    const replacement = path.join(f.root, "replacement-version.txt");
    await writeFile(replacement, "m_EditorVersion: 6000.3.21f1\n");
    await withVersionOperation(f, "lstat", async (initial) => {
      await rename(replacement, f.versionPath);
      return initial;
    }, () => assert.rejects(resolve(f), (error) => {
      assert.equal(error.code, "invalid_unity_version_file");
      assert.match(error.message, /changed before/);
      assert.equal(error.message.includes(f.root), false);
      return true;
    }));
  } finally { await cleanup(f.root); }
});

test("Unity ProjectVersion bounds a file that grows after its opened-handle check", async () => {
  const f = await fixture();
  try {
    let readBudget;
    await withVersionOperation(f, "open", async (handle) => {
      const original = handle.read.bind(handle);
      handle.read = async (...args) => {
        readBudget = args[0].length;
        await appendFile(f.versionPath, "x".repeat(131_072));
        return original(...args);
      };
      return handle;
    }, () => assert.rejects(resolve(f), (error) => {
      assert.equal(error.code, "invalid_unity_version_file");
      assert.match(error.message, /changed while/);
      return true;
    }));
    assert.equal(readBudget, Buffer.byteLength("m_EditorVersion: 6000.3.21f1\n") + 1,
      "Growth must not increase the allocation beyond the inspected size plus one byte.");
  } finally { await cleanup(f.root); }
});

test("Unity ProjectVersion rejects final-path replacement after reading the pinned handle", async () => {
  const f = await fixture();
  try {
    const replacement = path.join(f.root, "replacement-version.txt");
    await writeFile(replacement, "m_EditorVersion: 6000.3.21f1\n");
    await withVersionOperation(f, "open", async (handle) => {
      const original = handle.stat.bind(handle);
      let calls = 0;
      handle.stat = async (...args) => {
        const value = await original(...args);
        if (++calls === 2) await rename(replacement, f.versionPath);
        return value;
      };
      return handle;
    }, () => assert.rejects(resolve(f), (error) => {
      assert.equal(error.code, "invalid_unity_version_file");
      assert.match(error.message, /changed while/);
      return true;
    }));
  } finally { await cleanup(f.root); }
});

test("Unity ProjectVersion rejects a FIFO swap before open without waiting for a writer", async (t) => {
  if (process.platform === "win32" || fsConstants.O_NONBLOCK === undefined) {
    t.skip("POSIX FIFO replacement needs a platform with nonblocking filesystem open.");
    return;
  }
  const f = await fixture();
  try {
    const fifo = path.join(f.root, "version-pipe");
    const create = spawnSync("mkfifo", [fifo], { encoding: "utf8", timeout: 5000 });
    if (create.error || create.status !== 0) {
      t.skip(`POSIX FIFO fixture unavailable (${create.error?.code ?? "mkfifo refused"}).`);
      return;
    }
    // A separate process gives the regression a hard timeout: the former
    // blocking open cannot leave this test worker stuck inside libuv.
    const worker = `
      import filesystem from "node:fs/promises";
      import path from "node:path";
      import { syncBuiltinESMExports } from "node:module";
      const [source, fifo, managed] = process.argv.slice(1);
      const destination = path.join(source, "ProjectSettings", "ProjectVersion.txt");
      const original = filesystem.lstat;
      let swapped = false;
      filesystem.lstat = async (...args) => {
        const initial = await original(...args);
        if (!swapped && args[0] === destination) {
          swapped = true;
          await filesystem.rm(destination);
          await filesystem.rename(fifo, destination);
        }
        return initial;
      };
      syncBuiltinESMExports();
      const { ProjectPeerEngine } = await import(${JSON.stringify(new URL("../src/project-peer.mjs", import.meta.url).href)});
      try {
        await new ProjectPeerEngine({ managedRoot: managed }).resolveSourceProject({ projectRoot: source, projectId: "version-fifo" });
        process.exitCode = 1;
      } catch (error) {
        console.log(JSON.stringify({ code: error.code, swapped }));
        if (error.code !== "invalid_unity_version_file" || !swapped) process.exitCode = 1;
      }
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", worker, f.source, fifo, path.join(f.root, "managed")], {
      encoding: "utf8", timeout: 5000, killSignal: "SIGKILL", maxBuffer: 65_536,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { code: "invalid_unity_version_file", swapped: true });
  } finally { await cleanup(f.root); }
});
