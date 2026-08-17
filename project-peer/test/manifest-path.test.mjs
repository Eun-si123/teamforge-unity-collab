import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ChunkStore } from "../src/content-store.mjs";
import {
  buildManifest,
  assertEmbeddedPackageCoverage,
  calculateManifestHash,
  uniqueManifestChunks,
  validateManifest,
} from "../src/manifest.mjs";
import { discoverProjectContent, discoverProjectFiles, normalizeRelativePath } from "../src/path-policy.mjs";
import { cleanup, createUnityProject, temporaryRoot } from "./helpers.mjs";

test("manifest is deterministic, sorted, hash-sensitive, and reassembles 1 MiB chunks", async () => {
  const root = await temporaryRoot();
  try {
    const project = path.join(root, "project");
    const large = Buffer.alloc(2_300_000);
    for (let index = 0; index < large.length; index += 1) large[index] = index % 251;
    await createUnityProject(project, {
      assetFiles: { "Assets/Large.bin": large, "Assets/Empty.txt": "" },
    });
    const projectUuid = randomUUID();
    const firstStore = new ChunkStore(path.join(root, "store-a"));
    const secondStore = new ChunkStore(path.join(root, "store-b"));
    const first = await buildManifest({ projectRoot: project, projectUuid, baselineRevision: 1, store: firstStore });
    const second = await buildManifest({ projectRoot: project, projectUuid, baselineRevision: 1, store: secondStore });
    assert.deepEqual(first.manifest, second.manifest);
    assert.equal(first.manifestHash, second.manifestHash);
    assert.equal(calculateManifestHash(first.manifest), first.manifestHash);
    validateManifest(first.manifest, { expectedManifestHash: first.manifestHash });
    const largeEntry = first.manifest.files.find((file) => file.path === "Assets/Large.bin");
    assert.deepEqual(largeEntry.chunks.map((chunk) => chunk.size), [1_048_576, 1_048_576, 202_848]);
    const assembled = Buffer.concat(await Promise.all(
      largeEntry.chunks.map((chunk) => firstStore.read(chunk.hash, chunk.size)),
    ));
    assert.deepEqual(assembled, large);
    assert.deepEqual(
      first.manifest.files.map((file) => file.path),
      [...first.manifest.files.map((file) => file.path)].sort(),
    );

    await writeFile(path.join(project, "Assets", "Empty.txt"), "changed");
    const changed = await buildManifest({
      projectRoot: project,
      projectUuid,
      baselineRevision: 1,
      store: new ChunkStore(path.join(root, "store-c")),
    });
    assert.notEqual(changed.manifestHash, first.manifestHash);
  } finally {
    await cleanup(root);
  }
});

test("path policy rejects traversal, absolute, control, backslash, and non-NFC paths", () => {
  for (const invalid of [
    "../escape", "/absolute", "C:\\absolute", "//server/share", "Assets//Bad",
    "Assets/./Bad", "Assets/Bad\nName", "Assets\\Backslash", "Assets/e\u0301.txt",
    "Assets/CON", "Assets/nul.txt", "Assets/COM1.asset", "Assets/LPT9",
    "Assets/trailing. ", "Assets/trailing.", "Assets/name:stream", "Assets/bad?.txt",
  ]) {
    assert.throws(() => normalizeRelativePath(invalid));
  }
  assert.equal(normalizeRelativePath("Assets/é.txt"), "Assets/é.txt");
});

test("scanner includes internal local UPM, excludes generated/secrets/self-reference, and rejects external package", async () => {
  const root = await temporaryRoot();
  try {
    const project = path.join(root, "project");
    await createUnityProject(project, {
      dependencies: { "com.test.local": "file:Local/com.test.local" },
    });
    await mkdir(path.join(project, "Packages", "Local", "com.test.local"), { recursive: true });
    await writeFile(
      path.join(project, "Packages", "Local", "com.test.local", "package.json"),
      `${JSON.stringify({ name: "com.test.local", version: "1.0.0" })}\n`,
    );
    await writeFile(path.join(project, "Packages", "Local", "com.test.local", "Runtime.cs"), "class X {}\n");
    await writeFile(path.join(project, "Assets", ".env"), "TOKEN=secret\n");
    await writeFile(path.join(project, "Assets", "secret.key"), "secret\n");
    await writeFile(path.join(project, "Assets", "editor.dmp"), "crash\n");
    await writeFile(path.join(project, "Assets", "signing.pfx"), "secret\n");
    await writeFile(path.join(project, "Assets", "session.token"), "secret\n");
    await writeFile(path.join(project, "ProjectSettings", "TeamForgeProject.json"), "{\"self\":true}\n");
    for (const excludedDirectory of [
      ".git", ".vs", "Library", "Temp", "Logs", "obj", "UserSettings",
      "Build", "Builds", "Crash", "Crashes", "MemoryCaptures", "Recordings", "artifacts",
    ]) {
      await mkdir(path.join(project, "Assets", excludedDirectory), { recursive: true });
      await writeFile(
        path.join(project, "Assets", excludedDirectory, "must-not-transfer.txt"),
        "ignored\n",
      );
    }

    const files = await discoverProjectFiles(project);
    const paths = files.map((file) => file.path);
    assert(paths.includes("Packages/Local/com.test.local/package.json"));
    assert(paths.includes("Packages/Local/com.test.local/Runtime.cs"));
    assert(!paths.some((file) => file.includes(".env") || file.endsWith("secret.key") ||
      file.endsWith("editor.dmp") || file.endsWith("signing.pfx") ||
      file.endsWith("session.token") || file.includes("TeamForgeProject.json") ||
      file.endsWith("must-not-transfer.txt")));

    await writeFile(
      path.join(project, "Packages", "manifest.json"),
      JSON.stringify({ dependencies: { "com.bad.external": "file:../../outside-package" } }),
    );
    await assert.rejects(() => discoverProjectFiles(project), { code: "external_local_package" });
  } finally {
    await cleanup(root);
  }
});

test("scanner includes unlisted Embedded Packages, package metadata, and companion .meta without secrets", async () => {
  const root = await temporaryRoot();
  try {
    const project = path.join(root, "project");
    await createUnityProject(project);
    const embedded = path.join(project, "Packages", "com.example.embedded");
    await mkdir(path.join(embedded, "Editor"), { recursive: true });
    await mkdir(path.join(embedded, "Runtime"), { recursive: true });
    await writeFile(
      path.join(embedded, "package.json"),
      `${JSON.stringify({ name: "com.example.embedded", version: "2.3.4" })}\n`,
    );
    await writeFile(path.join(embedded, "Editor", "Tool.cs"), "class EmbeddedTool {}\n");
    await writeFile(path.join(embedded, "Editor", "Tool.cs.meta"), "fileFormatVersion: 2\n");
    await writeFile(path.join(embedded, "Runtime", "Runtime.asmdef"), "{}\n");
    await writeFile(path.join(project, "Packages", "com.example.embedded.meta"), "fileFormatVersion: 2\n");
    await writeFile(path.join(embedded, ".env"), "TEAMFORGE_AUTH_TOKEN=must-not-transfer\n");
    await mkdir(path.join(embedded, ".env.local"), { recursive: true });
    await writeFile(path.join(embedded, ".env.local", "hidden.txt"), "must-not-transfer\n");
    await writeFile(path.join(embedded, "owner.key"), "must-not-transfer\n");

    const store = new ChunkStore(path.join(root, "store-a"));
    const first = await buildManifest({
      projectRoot: project,
      projectUuid: randomUUID(),
      baselineRevision: 1,
      store,
    });
    const paths = first.manifest.files.map((file) => file.path);
    for (const expected of [
      "Packages/manifest.json",
      "Packages/packages-lock.json",
      "Packages/com.example.embedded.meta",
      "Packages/com.example.embedded/package.json",
      "Packages/com.example.embedded/Editor/Tool.cs",
      "Packages/com.example.embedded/Editor/Tool.cs.meta",
      "Packages/com.example.embedded/Runtime/Runtime.asmdef",
    ]) {
      assert(paths.includes(expected), `Expected Embedded Package path ${expected}.`);
    }
    assert(!paths.some((candidate) => candidate.includes("/.env") || candidate.endsWith("owner.key")));
    assert.deepEqual(first.embeddedPackages, [{
      name: "com.example.embedded",
      version: "2.3.4",
      path: "Packages/com.example.embedded",
      fileCount: 4,
      totalBytes: first.manifest.files
        .filter((file) => file.path.startsWith("Packages/com.example.embedded/"))
        .reduce((sum, file) => sum + file.size, 0),
      totalChunks: 4,
    }]);
    await assert.rejects(
      () => assertEmbeddedPackageCoverage(project, first.manifest.files.filter((file) =>
        file.path !== "Packages/com.example.embedded/package.json")),
      { code: "embedded_package_missing_from_manifest" },
    );

    const originalEntry = first.manifest.files.find((file) =>
      file.path === "Packages/com.example.embedded/Editor/Tool.cs");
    await writeFile(path.join(embedded, "Editor", "Tool.cs"), "class EmbeddedTool { int Changed; }\n");
    const changed = await buildManifest({
      projectRoot: project,
      projectUuid: first.manifest.projectUuid,
      baselineRevision: 2,
      store: new ChunkStore(path.join(root, "store-b")),
    });
    const changedEntry = changed.manifest.files.find((file) => file.path === originalEntry.path);
    assert.notEqual(changed.manifestHash, first.manifestHash);
    assert.notEqual(changedEntry.fileHash, originalEntry.fileHash);
    assert.notEqual(changedEntry.chunks[0].hash, originalEntry.chunks[0].hash);

    await rm(embedded, { recursive: true });
    await rm(path.join(project, "Packages", "com.example.embedded.meta"));
    const removed = await buildManifest({
      projectRoot: project,
      projectUuid: first.manifest.projectUuid,
      baselineRevision: 3,
      store: new ChunkStore(path.join(root, "store-c")),
    });
    assert.equal(removed.embeddedPackages.length, 0);
    assert(!removed.manifest.files.some((file) => file.path.startsWith("Packages/com.example.embedded")));
  } finally {
    await cleanup(root);
  }
});

test("local Package references use Unity's Packages base and retain fail-closed containment", async () => {
  const root = await temporaryRoot();
  try {
    const project = path.join(root, "project");
    await createUnityProject(project);
    const dependencies = {
      "com.example.internal": "file:../LocalPackages/com.example.internal",
      "com.example.windows": "file:..\\LocalPackages\\com.example.windows",
      "com.example.direct": "file:com.example.direct",
      "com.example.deep": "file:Nested/Safe/../com.example.deep",
    };
    const packages = [
      ["LocalPackages/com.example.internal", "com.example.internal"],
      ["LocalPackages/com.example.windows", "com.example.windows"],
      ["Packages/com.example.direct", "com.example.direct"],
      ["Packages/Nested/com.example.deep", "com.example.deep"],
    ];
    for (const [relative, name] of packages) {
      const packageRoot = path.join(project, ...relative.split("/"));
      await mkdir(packageRoot, { recursive: true });
      await writeFile(
        path.join(packageRoot, "package.json"),
        `${JSON.stringify({ name, version: "1.0.0" })}\n`,
      );
      await writeFile(path.join(packageRoot, "Runtime.cs"), `class ${name.replaceAll(".", "_")} {}\n`);
    }
    await writeFile(
      path.join(project, "Packages", "manifest.json"),
      `${JSON.stringify({ dependencies }, null, 2)}\n`,
    );

    const discovery = await discoverProjectContent(project);
    const paths = discovery.files.map((file) => file.path);
    for (const [relative] of packages) {
      assert(paths.includes(`${relative}/package.json`));
      assert(paths.includes(`${relative}/Runtime.cs`));
      assert(discovery.files
        .filter((file) => file.path.startsWith(`${relative}/`))
        .every((file) => file.kind === "package"));
    }
    assert(paths.every((candidate) => !candidate.includes("\\")));
    assert.equal(new Set(paths).size, paths.length);

    const outside = path.join(root, "outside");
    await mkdir(outside, { recursive: true });
    await writeFile(
      path.join(outside, "package.json"),
      `${JSON.stringify({ name: "com.example.external", version: "1.0.0" })}\n`,
    );
    await mkdir(path.join(project, "Packages", "no-package-json"), { recursive: true });
    await writeFile(path.join(project, "Packages", "not-a-directory"), "not a package directory\n");

    for (const [specification, code] of [
      ["file:../../outside", "external_local_package"],
      ["file:%2e%2e/%2e%2e/outside", "external_local_package"],
      ["file:C:/outside", "external_local_package"],
      ["file:C:\\outside", "external_local_package"],
      ["file:C:relative/package", "external_local_package"],
      ["file://server/share/package", "external_local_package"],
      ["file:\\\\server\\share\\package", "external_local_package"],
      ["file:\\outside", "external_local_package"],
      ["file:https://example.invalid/package", "external_local_package"],
      ["file:..", "external_local_package"],
      ["file:LocalPackages/com.example.internal", "invalid_embedded_package"],
      ["file:Packages/Local/com.example.internal", "invalid_embedded_package"],
      ["file:missing", "invalid_embedded_package"],
      ["file:no-package-json", "invalid_embedded_package"],
      ["file:not-a-directory", "invalid_embedded_package"],
      ["file:%ZZ", "invalid_local_package"],
      ["file:com.example.internal?query", "invalid_local_package"],
    ]) {
      await writeFile(
        path.join(project, "Packages", "manifest.json"),
        JSON.stringify({ dependencies: { "com.example.external": specification } }),
      );
      await assert.rejects(() => discoverProjectFiles(project), { code });
    }
  } finally {
    await cleanup(root);
  }
});

test("scanner rejects intermediate package symlink escape, missing lock metadata, and Owner identity JSON", async (context) => {
  const root = await temporaryRoot();
  try {
    const project = path.join(root, "project");
    const outside = path.join(root, "outside");
    await createUnityProject(project);
    await mkdir(path.join(outside, "com.example.escape"), { recursive: true });
    await writeFile(
      path.join(outside, "com.example.escape", "package.json"),
      `${JSON.stringify({ name: "com.example.escape", version: "1.0.0" })}\n`,
    );
    await writeFile(path.join(outside, "com.example.escape", "outside-secret.txt"), "outside\n");
    try {
      await symlink(outside, path.join(project, "LocalAlias"), "junction");
      await writeFile(
        path.join(project, "Packages", "manifest.json"),
        JSON.stringify({ dependencies: { "com.example.escape": "file:../LocalAlias/com.example.escape" } }),
      );
      await assert.rejects(() => discoverProjectFiles(project), { code: "symlink_rejected" });
    } catch (error) {
      if (["EPERM", "EACCES", "ENOSYS"].includes(error.code)) {
        context.diagnostic(`Intermediate symlink creation unavailable: ${error.code}`);
      } else {
        throw error;
      }
    }

    await rm(path.join(project, "LocalAlias"), { force: true, recursive: true });
    await writeFile(path.join(project, "Packages", "manifest.json"), "{\"dependencies\":{}}\n");
    await rm(path.join(project, "Packages", "packages-lock.json"));
    await assert.rejects(() => discoverProjectFiles(project), { code: "required_packages_lock_missing" });
    await writeFile(path.join(project, "Packages", "packages-lock.json"), "{\"dependencies\":{}}\n");

    await writeFile(
      path.join(project, "Assets", "renamed-identity.json"),
      JSON.stringify({
        schemaVersion: 1,
        keyId: "public-fingerprint",
        publicKey: "public-material",
        privateKey: "private-material",
      }),
    );
    await assert.rejects(() => discoverProjectFiles(project), { code: "secret_file_rejected" });
    await rm(path.join(project, "Assets", "renamed-identity.json"));
    await writeFile(path.join(project, "Assets", "server-auth-token.txt"), "never-transfer\n");
    const paths = (await discoverProjectFiles(project)).map((file) => file.path);
    assert(!paths.includes("Assets/server-auth-token.txt"));
  } finally {
    await cleanup(root);
  }
});

test("scanner rejects an Embedded Package symlink instead of following it", async (context) => {
  const root = await temporaryRoot();
  try {
    const project = path.join(root, "project");
    const external = path.join(root, "external-package");
    await createUnityProject(project);
    await mkdir(external, { recursive: true });
    await writeFile(
      path.join(external, "package.json"),
      `${JSON.stringify({ name: "com.example.escape", version: "1.0.0" })}\n`,
    );
    try {
      await symlink(external, path.join(project, "Packages", "com.example.escape"), "junction");
      await assert.rejects(() => discoverProjectFiles(project), { code: "symlink_rejected" });
    } catch (error) {
      if (["EPERM", "EACCES", "ENOSYS"].includes(error.code)) {
        context.diagnostic(`Package symlink creation unavailable: ${error.code}`);
      } else {
        throw error;
      }
    }
  } finally {
    await cleanup(root);
  }
});

test("scanner rejects symbolic links and case-insensitive collisions", async (context) => {
  const root = await temporaryRoot();
  try {
    const project = path.join(root, "project");
    await createUnityProject(project);
    const external = path.join(root, "external.txt");
    await writeFile(external, "outside");
    try {
      await symlink(external, path.join(project, "Assets", "Link.txt"));
      await assert.rejects(() => discoverProjectFiles(project), { code: "symlink_rejected" });
    } catch (error) {
      if (["EPERM", "EACCES", "ENOSYS"].includes(error.code)) {
        context.diagnostic(`Symlink creation unavailable: ${error.code}`);
      } else {
        throw error;
      }
    }
  } finally {
    await cleanup(root);
  }

  const collisionRoot = await temporaryRoot();
  try {
    const project = path.join(collisionRoot, "project");
    await createUnityProject(project);
    await writeFile(path.join(project, "Assets", "Case.txt"), "A");
    await writeFile(path.join(project, "Assets", "case.txt"), "B");
    const actual = await readFile(path.join(project, "Assets", "Case.txt"), "utf8");
    if (actual === "A") {
      await assert.rejects(() => discoverProjectFiles(project), { code: "case_collision" });
    } else {
      context.diagnostic("Filesystem is case-insensitive; distinct collision names could not be created.");
    }
  } finally {
    await cleanup(collisionRoot);
  }
});

test("manifest validator rejects case collision and malformed chunk coverage", async () => {
  const root = await temporaryRoot();
  try {
    const project = path.join(root, "project");
    await createUnityProject(project);
    const { manifest } = await buildManifest({
      projectRoot: project,
      projectUuid: randomUUID(),
      baselineRevision: 1,
      store: new ChunkStore(path.join(root, "store")),
    });
    const malformed = structuredClone(manifest);
    malformed.files[0].chunks[0].offset = 10;
    malformed.manifestHash = calculateManifestHash(malformed);
    assert.throws(() => validateManifest(malformed), { code: "invalid_manifest_chunk" });
    assert(uniqueManifestChunks(manifest).length > 0);
  } finally {
    await cleanup(root);
  }
});
