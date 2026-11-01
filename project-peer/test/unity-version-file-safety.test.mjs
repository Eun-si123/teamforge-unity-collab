import assert from "node:assert/strict";
import test from "node:test";
import { rm, symlink, writeFile } from "node:fs/promises";
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
