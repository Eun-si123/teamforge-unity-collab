import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parsePreflightArguments } from "../src/preflight-cli.mjs";
import {
  inspectPreflight,
  probePort,
  repairDependencies,
} from "../src/unified-preflight.mjs";

async function temporaryRoot() {
  return mkdtemp(path.join(os.tmpdir(), "teamforge-wp1-"));
}

async function writeJson(destination, value) {
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(value, null, 2)}\n`);
}

async function createDependencyTarget(root, target, { installed = true } = {}) {
  const packageRoot = path.join(root, target);
  const manifest = {
    name: target === "server" ? "unity-teamforge-server" : "@eunsung/teamforge-project-peer",
    version: "0.5.1",
    engines: { node: ">=22.23.2 <23 || >=24.18.1 <25" },
    dependencies: { ws: "8.21.3" },
  };
  const lockfile = {
    name: manifest.name,
    version: manifest.version,
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": manifest,
      "node_modules/ws": { version: "8.21.3" },
    },
  };
  await writeJson(path.join(packageRoot, "package.json"), manifest);
  await writeJson(path.join(packageRoot, "package-lock.json"), lockfile);
  if (installed) {
    await writeJson(path.join(packageRoot, "node_modules", "ws", "package.json"), {
      name: "ws",
      version: "8.21.3",
    });
  }
}

async function createWorkspace({ serverInstalled = true, peerInstalled = true } = {}) {
  const root = await temporaryRoot();
  await createDependencyTarget(root, "server", { installed: serverInstalled });
  await createDependencyTarget(root, "project-peer", { installed: peerInstalled });
  await writeJson(path.join(root, "package-lock.json"), {
    name: "unity-teamforge-workspace",
    version: "0.5.1",
    lockfileVersion: 3,
    packages: {
      "": { workspaces: ["server", "project-peer"] },
      server: { name: "unity-teamforge-server" },
      "project-peer": { name: "@eunsung/teamforge-project-peer" },
    },
  });
  return root;
}

const passPortProbe = async ({ host, port }) => ({
  id: `port.${host}:${port}`,
  status: port === 0 ? "not_requested" : "pass",
  message: port === 0 ? "No fixed port was requested." : "No listener.",
  host,
  port,
  state: port === 0 ? "not_requested" : "no_listener",
});

const runtimeRunner = async (_executable, args) => {
  assert(args[0].endsWith("npm-cli.js"));
  assert.deepEqual(args.slice(1), ["--version"]);
  return { code: 0, stdout: "11.16.0" };
};

function runtimeOptions(root) {
  return {
    workspaceRoot: root,
    nodePath: path.join(root, "runtime", "node.exe"),
    nodeVersion: "24.18.1",
    npmCliPath: path.join(root, "runtime", "npm-cli.js"),
    commandRunner: runtimeRunner,
    portProbe: passPortProbe,
  };
}

async function createLaunchFixture(root) {
  const projectRoot = path.join(root, "Unity Project");
  const managedRoot = path.join(root, "TeamForgeProjects");
  await mkdir(path.join(projectRoot, "ProjectSettings"), { recursive: true });
  await writeFile(
    path.join(projectRoot, "ProjectSettings", "ProjectVersion.txt"),
    "m_EditorVersion: 6000.3.21f1\n",
  );
  const launchPath = path.join(root, "teamforge-project-peer.launch.json");
  await writeJson(launchPath, {
    schemaVersion: 1,
    serverAddress: "http://127.0.0.1:5080",
    realtimePath: "ws",
    projectId: "wp1-project",
    sessionId: "editors",
    projectUuid: randomUUID(),
    sourceProjectRelativePath: "Unity Project",
    projectDescriptorRelativePath: "Unity Project/ProjectSettings/TeamForgeProject.json",
    managedProjectsRelativePath: "TeamForgeProjects",
    realtimeProtocolVersion: 1,
    transferProtocolVersion: 1,
    manifestSchemaVersion: 1,
    authenticationTokenEnvironmentVariable: "TEAMFORGE_AUTH_TOKEN",
    ownerKeyEnvironmentVariable: "TEAMFORGE_OWNER_PRIVATE_KEY",
    allowCurrentProjectAsSeedSource: true,
  });
  return { launchPath, projectRoot, managedRoot };
}

test("unified inspect validates runtime, locked dependencies, launch paths, Unity version, and managed root without writing", async () => {
  const root = await createWorkspace();
  try {
    const fixture = await createLaunchFixture(root);
    const result = await inspectPreflight({
      ...runtimeOptions(root),
      launchSettingsPath: fixture.launchPath,
    });
    assert.equal(result.state, "idle");
    assert.equal(result.mutatesLocalState, false);
    assert.equal(result.mutatesRemoteState, false);
    assert.equal(result.resolved.projectRoot, fixture.projectRoot);
    assert.equal(result.resolved.managedRoot, fixture.managedRoot);
    assert.equal(result.checks.find((item) => item.id === "project.version").status, "pass");
    assert.equal(result.checks.find((item) => item.id === "managed_root").state, "creatable_parent_writable");
    await assert.rejects(() => readFile(fixture.managedRoot), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unified inspect enforces the security-patched Node 22 and 24 floors", async () => {
  const root = await createWorkspace();
  try {
    const fixture = await createLaunchFixture(root);
    for (const nodeVersion of ["22.23.1", "24.18.0"]) {
      const result = await inspectPreflight({
        ...runtimeOptions(root),
        nodeVersion,
        launchSettingsPath: fixture.launchPath,
      });
      const runtimeCheck = result.checks.find((item) => item.id === "runtime.node");
      assert.equal(runtimeCheck.status, "fail");
      assert.equal(runtimeCheck.failure.rawCode, "unsupported_node_version");
    }
    for (const nodeVersion of ["22.23.2", "24.18.1"]) {
      const result = await inspectPreflight({
        ...runtimeOptions(root),
        nodeVersion,
        launchSettingsPath: fixture.launchPath,
      });
      assert.equal(result.checks.find((item) => item.id === "runtime.node").status, "pass");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing ws is normalized to the frozen dependencies_not_ready action", async () => {
  const root = await createWorkspace({ peerInstalled: false });
  try {
    const result = await inspectPreflight(runtimeOptions(root));
    assert.equal(result.state, "needs_action");
    const missing = result.checks.find((item) => item.id === "project-peer.dependency.ws");
    assert.equal(missing.failure.kind, "dependencies_not_ready");
    assert.equal(missing.failure.action, "repair_dependencies");
    assert.equal(result.dependencyTargets.find((item) => item.target === "server").ready, true);
    assert.equal(result.dependencyTargets.find((item) => item.target === "project-peer").ready, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bundled runtime inspect never resolves or executes npm and reports package discovery", async () => {
  const root = await createWorkspace();
  let calls = 0;
  try {
    const result = await inspectPreflight({
      ...runtimeOptions(root),
      runtimeKind: "bundled_package",
      commandRunner: async () => { calls += 1; throw new Error("must not execute"); },
    });
    assert.equal(result.state, "idle");
    assert.equal(result.runtimeStrategy.kind, "bundled_package");
    assert.equal(result.runtimeStrategy.npmCli, null);
    assert.equal(result.runtimeStrategy.bundledRuntime, "verified_by_package_discovery");
    assert.equal(result.checks.find((item) => item.id === "runtime.npm").status, "not_requested");
    assert.equal(calls, 0);
    const installed = await inspectPreflight({
      ...runtimeOptions(root),
      runtimeKind: "installed_package_runtime",
      commandRunner: async () => { calls += 1; throw new Error("must not execute"); },
    });
    assert.equal(installed.state, "idle");
    assert.equal(installed.runtimeStrategy.kind, "installed_package_runtime");
    assert.equal(installed.runtimeStrategy.npmCli, null);
    assert.equal(calls, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bundled runtime refuses dependency repair and never mutates a corrupt payload", async () => {
  const root = await createWorkspace({ peerInstalled: false });
  let calls = 0;
  try {
    const result = await repairDependencies({
      ...runtimeOptions(root),
      runtimeKind: "bundled_package",
      confirmRepair: true,
      commandRunner: async () => { calls += 1; throw new Error("must not execute"); },
    });
    assert.equal(result.state, "needs_action");
    assert.equal(result.changed, false);
    assert.equal(result.mutatesLocalState, false);
    assert.equal(result.failures[0].rawCode, "runtime_bundle_corrupt");
    assert.equal(calls, 0);
    await assert.rejects(() => readFile(path.join(root, ".teamforge-dependency-repair.lock")), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dependency repair is a no-op when both locked installations are already ready", async () => {
  const root = await createWorkspace();
  let calls = 0;
  try {
    const result = await repairDependencies({
      ...runtimeOptions(root),
      confirmRepair: true,
      commandRunner: async (_executable, args) => {
        calls += 1;
        assert.deepEqual(args.slice(1), ["--version"]);
        return { code: 0, stdout: "11.16.0" };
      },
    });
    assert.equal(result.state, "idle");
    assert.equal(result.changed, false);
    assert.equal(result.mutatesLocalState, false);
    assert.equal(calls, 1, "only the read-only npm version probe should run");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("explicit dependency repair runs locked npm ci only for the missing workspace and rechecks it", async () => {
  const root = await createWorkspace({ peerInstalled: false });
  const calls = [];
  try {
    const result = await repairDependencies({
      ...runtimeOptions(root),
      confirmRepair: true,
      commandRunner: async (executable, args, processOptions = {}) => {
        calls.push({ executable, args, cwd: processOptions.cwd });
        if (args.at(-1) === "--version") return { code: 0, stdout: "11.16.0" };
        await writeJson(path.join(processOptions.cwd, "node_modules", "ws", "package.json"), {
          name: "ws",
          version: "8.21.3",
        });
        return { code: 0, stdout: "" };
      },
    });
    assert.equal(result.state, "idle");
    assert.equal(result.changed, true);
    assert.equal(result.mutatesRemoteState, false);
    assert.deepEqual(result.repairs.map((item) => item.target), ["project-peer"]);
    assert.deepEqual(calls[1].args.slice(1), [
      "ci", "--ignore-scripts", "--no-audit", "--no-fund", "--workspaces=false",
    ]);
    await assert.rejects(
      () => readFile(path.join(root, ".teamforge-dependency-repair.lock")),
      { code: "ENOENT" },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dependency repair refuses to mutate while a configured TeamForge port is occupied", async () => {
  const root = await createWorkspace({ peerInstalled: false });
  let installCalled = false;
  try {
    const result = await repairDependencies({
      ...runtimeOptions(root),
      confirmRepair: true,
      commandRunner: async (_executable, args) => {
        if (args.at(-1) === "--version") return { code: 0, stdout: "11.16.0" };
        installCalled = true;
        return { code: 0, stdout: "" };
      },
      portProbe: async ({ host, port }) => port === 5080
        ? {
          id: `port.${host}:${port}`,
          status: "fail",
          message: "occupied",
          failure: {
            kind: "port_conflict",
            rawCode: "port_occupied_unverified",
            message: "occupied",
            recoverable: true,
            action: "inspect_port_owner",
          },
        }
        : passPortProbe({ host, port }),
    });
    assert.equal(result.state, "needs_action");
    assert.equal(result.changed, false);
    assert.equal(installCalled, false);
    assert.equal(result.failures[0].kind, "port_conflict");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("real TCP probe reports an accepting listener as occupied without claiming ownership", async () => {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    const result = await probePort({ host: "127.0.0.1", port: address.port });
    assert.equal(result.status, "fail");
    assert.equal(result.state, "occupied_unverified");
    assert.equal(result.failure.kind, "port_conflict");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("preflight CLI keeps paths absolute and requires explicit repair confirmation", () => {
  const parsed = parsePreflightArguments([
    "repair-dependencies",
    "--workspace-root", ".",
    "--server-port", "5080",
    "--seed-port", "0",
    "--confirm-repair",
  ]);
  assert.equal(parsed.command, "repair-dependencies");
  assert.equal(path.isAbsolute(parsed.options.workspaceRoot), true);
  assert.equal(parsed.options.confirmRepair, true);
  assert.throws(
    () => parsePreflightArguments(["inspect", "--confirm-repair"]),
    { code: "invalid_preflight_option" },
  );
});
