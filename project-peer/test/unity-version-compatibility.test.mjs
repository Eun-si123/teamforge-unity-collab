import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ProjectPeerEngine } from "../src/project-peer.mjs";
import { calculateDescriptorHash, validateDescriptor } from "../src/descriptor.mjs";
import { inspectPreflight } from "../src/unified-preflight.mjs";
import { UNITY_DESCRIPTOR_RELATIVE_PATH, unityProjectDescriptorFromBaseline } from "../src/unity-project-descriptor.mjs";
import { cleanup, createUnityProject, temporaryRoot } from "./helpers.mjs";

const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));

async function fixture(version) {
  const root = await temporaryRoot("teamforge-unity-compatibility-");
  const source = path.join(root, "source");
  await createUnityProject(source, { unityVersion: version });
  return { root, source, engine: new ProjectPeerEngine({ managedRoot: path.join(root, "managed") }) };
}

async function versionCheck(f) {
  const result = await inspectPreflight({
    workspaceRoot, projectRoot: f.source, managedRoot: path.join(f.root, "preflight-managed"),
    nodePath: process.execPath, nodeVersion: process.versions.node, runtimeKind: "bundled_package",
    serverPort: 0, seedPort: 0,
    portProbe: async ({ host, port }) => ({ id: `port.${host}:${port}`, status: "not_requested", message: "No test listener requested." }),
  });
  assert.equal(result.mutatesLocalState, false);
  assert.equal(result.mutatesRemoteState, false);
  return result.checks.find(check => check.id === "project.version");
}

test("source resolution preserves baseline and experimental full Editor versions", async () => {
  for (const version of ["6000.3.21f1", "6000.3.27f2", "6000.6.7f1"]) {
    const f = await fixture(version);
    try {
      const resolved = await f.engine.resolveSourceProject({ projectRoot: f.source, projectId: "unity-version-compatibility" });
      assert.equal(resolved.unityVersion, version);
      assert.equal(await readFile(path.join(f.source, "ProjectSettings", "ProjectVersion.txt"), "utf8"), `m_EditorVersion: ${version}\n`);
    } finally { await cleanup(f.root); }
  }
});

test("preflight labels experimental admission without changing the valid marker or claiming field evidence", async () => {
  for (const [version, compatibility] of [["6000.3.21f1", "lts"], ["6000.3.27f2", "lts"], ["6000.6.7f1", "experimental"]]) {
    const f = await fixture(version);
    try {
      const check = await versionCheck(f);
      assert.equal(check.status, "pass");
      assert.equal(check.version, version);
      assert.equal(check.compatibility, compatibility);
      if (compatibility === "experimental") {
        assert.match(check.message, /experimental/u);
        assert.match(check.message, /not release or field evidence/u);
      }
    } finally { await cleanup(f.root); }
  }
});

test("Publisher and preflight still reject unknown lines and experimental prereleases", async () => {
  for (const version of ["6000.6.7a1", "6000.6.7b1", "6000.6.7p1", "6000.7.1f1", "7000.0.1f1", "2022.3.62f3"]) {
    const f = await fixture(version);
    try {
      await assert.rejects(f.engine.resolveSourceProject({ projectRoot: f.source, projectId: "unity-version-refusal" }),
        { code: "unsupported_unity_version" });
      const check = await versionCheck(f);
      assert.equal(check.status, "fail");
      assert.equal(check.failure.rawCode, "unsupported_unity_version");
    } finally { await cleanup(f.root); }
  }
});

test("experimental publication signs the exact version and rejects metadata-only version substitution", async () => {
  const f = await fixture("6000.6.7f1");
  try {
    const publication = await f.engine.preparePublication({ projectRoot: f.source,
      projectId: "experimental-publication", baselineRevision: 1, chunkSize: 65_536 });
    const descriptor = publication.descriptor;
    assert.equal(descriptor.unityVersion, "6000.6.7f1");
    assert.equal(descriptor.projectUuid, publication.project.projectUuid);
    assert.equal(descriptor.descriptorHash, calculateDescriptorHash(descriptor));
    assert.doesNotThrow(() => validateDescriptor(descriptor));
    const substituted = { ...descriptor, unityVersion: "6000.3.21f1" };
    assert.notEqual(calculateDescriptorHash(substituted), descriptor.descriptorHash);
    assert.throws(() => validateDescriptor(substituted), { code: "invalid_baseline_signature" });

    const marker = unityProjectDescriptorFromBaseline(descriptor);
    marker.unityVersion = "6000.3.21f1";
    await writeFile(path.join(f.source, UNITY_DESCRIPTOR_RELATIVE_PATH), JSON.stringify(marker));
    await assert.rejects(f.engine.resolveSourceProject({ projectRoot: f.source, projectId: "experimental-publication" }),
      { code: "unity_version_mismatch" });
  } finally { await cleanup(f.root); }
});
