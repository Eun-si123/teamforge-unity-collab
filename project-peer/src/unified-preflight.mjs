import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
  access,
  lstat,
  open,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { loadLaunchSettings } from "./launch-settings.mjs";
import {
  ORCHESTRATOR_API_VERSION,
  normalizeOrchestratorFailure,
} from "./orchestrator-contract.mjs";

export const PREFLIGHT_MINIMUM_NODE_MAJOR = 22;
export const PREFLIGHT_SUPPORTED_NODE_MAJORS = Object.freeze([22, 24]);
export const PREFLIGHT_MINIMUM_NODE_VERSIONS = Object.freeze({
  22: Object.freeze([22, 23, 2]),
  24: Object.freeze([24, 18, 1]),
});
export const PREFLIGHT_CHECK_STATUS = Object.freeze({
  pass: "pass",
  fail: "fail",
  notRequested: "not_requested",
});

const DEPENDENCY_TARGETS = Object.freeze(["server", "project-peer"]);
const REPAIR_ARGUMENTS = Object.freeze([
  "ci",
  "--ignore-scripts",
  "--no-audit",
  "--no-fund",
  "--workspaces=false",
]);

function check(id, status, message, extra = {}) {
  return Object.freeze({ id, status, message, ...extra });
}

function failureCheck(id, code, message, extra = {}) {
  return check(id, PREFLIGHT_CHECK_STATUS.fail, message, {
    ...extra,
    failure: normalizeOrchestratorFailure({ code, message }),
  });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function directDependencies(manifest) {
  const combined = {
    ...(manifest.dependencies ?? {}),
    ...(manifest.optionalDependencies ?? {}),
  };
  return Object.fromEntries(Object.entries(combined).sort(([left], [right]) => left.localeCompare(right)));
}

export async function inspectDependencyTarget(workspaceRoot, target) {
  const root = path.resolve(workspaceRoot, target);
  const manifestPath = path.join(root, "package.json");
  const lockfilePath = path.join(root, "package-lock.json");
  const checks = [];
  let manifest;
  let lockfile;

  try {
    manifest = await readJson(manifestPath);
    checks.push(check(`${target}.manifest`, PREFLIGHT_CHECK_STATUS.pass, "package.json is readable.", {
      path: manifestPath,
    }));
  } catch {
    checks.push(failureCheck(
      `${target}.manifest`,
      "dependency_contract_invalid",
      `${target}/package.json is missing or invalid.`,
      { path: manifestPath },
    ));
  }

  try {
    lockfile = await readJson(lockfilePath);
    checks.push(check(`${target}.lockfile`, PREFLIGHT_CHECK_STATUS.pass, "package-lock.json is readable.", {
      path: lockfilePath,
    }));
  } catch {
    checks.push(failureCheck(
      `${target}.lockfile`,
      "lockfile_missing",
      `${target}/package-lock.json is missing or invalid.`,
      { path: lockfilePath },
    ));
  }

  let repairable = Boolean(manifest && lockfile);
  if (manifest && lockfile) {
    const manifestDependencies = directDependencies(manifest);
    const lockedDependencies = directDependencies(lockfile.packages?.[""] ?? {});
    if (JSON.stringify(manifestDependencies) !== JSON.stringify(lockedDependencies)) {
      repairable = false;
      checks.push(failureCheck(
        `${target}.dependency_contract`,
        "dependency_contract_invalid",
        `${target} manifest and lockfile direct dependencies differ; npm ci would fail closed.`,
      ));
    } else {
      checks.push(check(
        `${target}.dependency_contract`,
        PREFLIGHT_CHECK_STATUS.pass,
        "Manifest and lockfile direct dependencies agree.",
      ));
    }

    for (const [name] of Object.entries(manifestDependencies)) {
      const installedPath = path.join(root, "node_modules", ...name.split("/"), "package.json");
      const lockedVersion = lockfile.packages?.[`node_modules/${name}`]?.version;
      let installedVersion;
      try {
        installedVersion = (await readJson(installedPath)).version;
      } catch {
        checks.push(failureCheck(
          `${target}.dependency.${name}`,
          "dependency_missing",
          `${target} dependency ${name} is not installed.`,
          { path: installedPath, expectedVersion: lockedVersion ?? null },
        ));
        continue;
      }
      if (!lockedVersion || installedVersion !== lockedVersion) {
        checks.push(failureCheck(
          `${target}.dependency.${name}`,
          "dependency_stale",
          `${target} dependency ${name} does not match the lockfile.`,
          { path: installedPath, expectedVersion: lockedVersion ?? null, installedVersion },
        ));
      } else {
        checks.push(check(
          `${target}.dependency.${name}`,
          PREFLIGHT_CHECK_STATUS.pass,
          `${name}@${installedVersion} matches the lockfile.`,
          { path: installedPath, installedVersion },
        ));
      }
    }
  }

  return Object.freeze({
    target,
    root,
    ready: checks.every((item) => item.status !== PREFLIGHT_CHECK_STATUS.fail),
    repairable,
    checks: Object.freeze(checks),
  });
}

async function inspectWorkspaceLock(workspaceRoot) {
  const lockfilePath = path.join(workspaceRoot, "package-lock.json");
  try {
    const lockfile = await readJson(lockfilePath);
    const expected = DEPENDENCY_TARGETS.every((target) => lockfile.packages?.[target]);
    return expected
      ? check("workspace.lockfile", PREFLIGHT_CHECK_STATUS.pass, "Workspace lockfile contains both workspaces.", {
        path: lockfilePath,
      })
      : failureCheck(
        "workspace.lockfile",
        "dependency_contract_invalid",
        "Workspace lockfile does not contain both TeamForge workspaces.",
        { path: lockfilePath },
      );
  } catch {
    return failureCheck(
      "workspace.lockfile",
      "lockfile_missing",
      "Workspace package-lock.json is missing or invalid.",
      { path: lockfilePath },
    );
  }
}

function nodeRuntimeCheck(nodeVersion = process.versions.node, nodePath = process.execPath) {
  const parsed = String(nodeVersion).match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u);
  const version = parsed ? parsed.slice(1, 4).map((item) => Number.parseInt(item, 10)) : [];
  const major = version[0];
  const minimum = PREFLIGHT_MINIMUM_NODE_VERSIONS[major];
  let meetsFloor = Boolean(minimum);
  for (let index = 0; minimum && index < minimum.length; index += 1) {
    if (version[index] === minimum[index]) continue;
    meetsFloor = version[index] > minimum[index];
    break;
  }
  if (!PREFLIGHT_SUPPORTED_NODE_MAJORS.includes(major) || !meetsFloor) {
    return failureCheck(
      "runtime.node",
      "unsupported_node_version",
      "TeamForge requires a security-patched Node.js LTS " +
        "(>=22.23.2 <23 or >=24.18.1 <25).",
      { version: nodeVersion, executable: path.resolve(nodePath) },
    );
  }
  return check(
    "runtime.node",
    PREFLIGHT_CHECK_STATUS.pass,
    `Node.js ${nodeVersion} is supported.`,
    { version: nodeVersion, executable: path.resolve(nodePath) },
  );
}

async function fileCandidate(candidate) {
  try {
    const resolved = await realpath(candidate);
    const details = await lstat(resolved);
    return details.isFile() ? resolved : "";
  } catch {
    return "";
  }
}

export async function resolveNpmCli({ nodePath = process.execPath, env = process.env } = {}) {
  const executableDirectory = path.dirname(path.resolve(nodePath));
  const candidates = [
    env.npm_execpath,
    path.join(executableDirectory, "node_modules", "npm", "bin", "npm-cli.js"),
    path.resolve(executableDirectory, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ].filter((candidate) => typeof candidate === "string" && path.isAbsolute(candidate));
  for (const candidate of candidates) {
    const resolved = await fileCandidate(candidate);
    if (resolved) return resolved;
  }
  return "";
}

export function runProcess(executable, arguments_, { cwd, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, arguments_, {
      cwd,
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      if (stdout.length < 4_096) stdout += chunk.toString("utf8", 0, 4_096 - stdout.length);
    });
    child.stderr.on("data", () => {});
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout: stdout.trim() }));
  });
}

async function inspectNpm({ nodePath, npmCliPath, commandRunner }) {
  if (!npmCliPath) {
    return failureCheck("runtime.npm", "npm_unavailable", "npm CLI could not be resolved to an absolute path.");
  }
  try {
    const result = await commandRunner(nodePath, [npmCliPath, "--version"]);
    if (result.code !== 0 || !/^\d+\.\d+\.\d+(?:[-+].*)?$/u.test(result.stdout)) {
      return failureCheck("runtime.npm", "npm_unavailable", "npm CLI version probe failed.", {
        executable: npmCliPath,
      });
    }
    return check("runtime.npm", PREFLIGHT_CHECK_STATUS.pass, `npm ${result.stdout} is available.`, {
      executable: npmCliPath,
      version: result.stdout,
    });
  } catch {
    return failureCheck("runtime.npm", "npm_unavailable", "npm CLI version probe failed.", {
      executable: npmCliPath,
    });
  }
}

export function probePort({ host, port, timeoutMilliseconds = 400 } = {}) {
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    return Promise.resolve(check(
      `port.${host ?? "unspecified"}:${port ?? "unspecified"}`,
      PREFLIGHT_CHECK_STATUS.notRequested,
      "No fixed port was requested.",
      { host: host ?? null, port: port ?? null, state: "not_requested" },
    ));
  }
  const probeHost = host === "0.0.0.0" ? "127.0.0.1" : host === "::" ? "::1" : host;
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: probeHost, port });
    let completed = false;
    const finish = (value) => {
      if (completed) return;
      completed = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMilliseconds, () => finish(failureCheck(
      `port.${host}:${port}`,
      "port_probe_inconclusive",
      `Port ${host}:${port} did not produce a conclusive read-only result.`,
      { host, port, state: "unknown" },
    )));
    socket.once("connect", () => finish(failureCheck(
      `port.${host}:${port}`,
      "port_occupied_unverified",
      `Port ${host}:${port} accepts TCP connections; ownership is unverified.`,
      { host, port, state: "occupied_unverified" },
    )));
    socket.once("error", (error) => {
      if (error.code === "ECONNREFUSED") {
        finish(check(
          `port.${host}:${port}`,
          PREFLIGHT_CHECK_STATUS.pass,
          `Port ${host}:${port} has no accepting TCP listener.`,
          { host, port, state: "no_listener" },
        ));
      } else {
        finish(failureCheck(
          `port.${host}:${port}`,
          "port_probe_inconclusive",
          `Port ${host}:${port} could not be inspected conclusively.`,
          { host, port, state: "unknown", errorCode: error.code ?? "unknown" },
        ));
      }
    });
  });
}

async function inspectUnityProject(projectRoot) {
  if (!projectRoot) {
    return check("project.version", PREFLIGHT_CHECK_STATUS.notRequested, "No source Project was requested.");
  }
  const root = path.resolve(projectRoot);
  const versionPath = path.join(root, "ProjectSettings", "ProjectVersion.txt");
  let source;
  try {
    const details = await lstat(versionPath);
    if (!details.isFile() || details.isSymbolicLink() || details.size <= 0 || details.size > 65_536) {
      throw new Error("not a bounded regular file");
    }
    source = await readFile(versionPath, "utf8");
  } catch {
    return failureCheck(
      "project.version",
      "unity_project_version_missing",
      "ProjectSettings/ProjectVersion.txt is missing or unsafe.",
      { projectRoot: root, path: versionPath },
    );
  }
  const version = source.match(/^m_EditorVersion:\s*([^\s]+)$/mu)?.[1];
  if (!version || !/^6000\.3\.\d+f\d+$/u.test(version)) {
    return failureCheck(
      "project.version",
      "unsupported_unity_version",
      "ProjectVersion.txt must record a Unity 6000.3.x Editor version.",
      { projectRoot: root, path: versionPath, version: version ?? null },
    );
  }
  return check("project.version", PREFLIGHT_CHECK_STATUS.pass, `Unity ${version} Project marker is valid.`, {
    projectRoot: root,
    path: versionPath,
    version,
  });
}

async function nearestExistingDirectory(candidate) {
  let current = path.resolve(candidate);
  while (true) {
    try {
      const details = await lstat(current);
      return details.isDirectory() && !details.isSymbolicLink() ? current : "";
    } catch (error) {
      if (error.code !== "ENOENT") return "";
    }
    const parent = path.dirname(current);
    if (parent === current) return "";
    current = parent;
  }
}

async function inspectManagedRoot(managedRoot) {
  if (!managedRoot) {
    return check("managed_root", PREFLIGHT_CHECK_STATUS.notRequested, "No managed root was requested.");
  }
  const root = path.resolve(managedRoot);
  try {
    const details = await lstat(root);
    if (!details.isDirectory() || details.isSymbolicLink()) {
      return failureCheck(
        "managed_root",
        "invalid_managed_root",
        "Managed root must be a real directory, not a file or symbolic link.",
        { path: root },
      );
    }
    await access(root, fsConstants.W_OK);
    return check("managed_root", PREFLIGHT_CHECK_STATUS.pass, "Managed root is writable by the current process.", {
      path: root,
      state: "existing_writable",
    });
  } catch (error) {
    if (error.code !== "ENOENT") {
      return failureCheck(
        "managed_root",
        "managed_root_not_writable",
        "Managed root is not writable by the current process.",
        { path: root },
      );
    }
  }
  const ancestor = await nearestExistingDirectory(path.dirname(root));
  if (!ancestor) {
    return failureCheck(
      "managed_root",
      "managed_root_not_writable",
      "No safe existing parent was found for the managed root.",
      { path: root },
    );
  }
  try {
    await access(ancestor, fsConstants.W_OK);
    return check(
      "managed_root",
      PREFLIGHT_CHECK_STATUS.pass,
      "Managed root does not exist; its nearest existing parent is writable. No directory was created.",
      { path: root, nearestExistingParent: ancestor, state: "creatable_parent_writable" },
    );
  } catch {
    return failureCheck(
      "managed_root",
      "managed_root_not_writable",
      "The nearest existing parent of the managed root is not writable.",
      { path: root, nearestExistingParent: ancestor },
    );
  }
}

function samePath(left, right) {
  if (!left || !right) return true;
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

async function inspectPaths({ launchSettingsPath, projectRoot, managedRoot }) {
  const checks = [];
  let launch = null;
  if (launchSettingsPath) {
    try {
      launch = await loadLaunchSettings(path.resolve(launchSettingsPath));
      checks.push(check(
        "launch_settings",
        PREFLIGHT_CHECK_STATUS.pass,
        "Launch settings passed the existing strict parser.",
        { path: launch.filePath },
      ));
    } catch (error) {
      checks.push(failureCheck(
        "launch_settings",
        error.code ?? "launch_settings_load_failed",
        error.message || "Launch settings are invalid.",
        { path: path.resolve(launchSettingsPath) },
      ));
    }
  } else {
    checks.push(check(
      "launch_settings",
      PREFLIGHT_CHECK_STATUS.notRequested,
      "No launch-settings file was requested.",
    ));
  }

  if (launch && projectRoot && !samePath(launch.sourceProjectRoot, projectRoot)) {
    checks.push(failureCheck(
      "project.path_consistency",
      "invalid_project_root",
      "Explicit source Project differs from the launch-settings source Project.",
    ));
  }
  if (launch && managedRoot && !samePath(launch.managedRoot, managedRoot)) {
    checks.push(failureCheck(
      "managed_root.path_consistency",
      "invalid_managed_root",
      "Explicit managed root differs from the launch-settings managed root.",
    ));
  }

  const resolvedProjectRoot = launch?.sourceProjectRoot || (projectRoot ? path.resolve(projectRoot) : "");
  const resolvedManagedRoot = launch?.managedRoot || (managedRoot ? path.resolve(managedRoot) : "");
  checks.push(await inspectUnityProject(resolvedProjectRoot));
  checks.push(await inspectManagedRoot(resolvedManagedRoot));
  return {
    checks,
    resolved: Object.freeze({
      launchSettingsPath: launch?.filePath ?? (launchSettingsPath ? path.resolve(launchSettingsPath) : null),
      projectRoot: resolvedProjectRoot || null,
      managedRoot: resolvedManagedRoot || null,
    }),
    launch,
  };
}

function serverProbeFromOptions(options, launch) {
  if (options.serverPort !== undefined || options.serverHost) {
    return { host: options.serverHost ?? "127.0.0.1", port: options.serverPort ?? 5080 };
  }
  if (launch) {
    const url = new URL(launch.settings.serverAddress);
    return {
      host: url.hostname.replace(/^\[|\]$/gu, ""),
      port: Number(url.port || (url.protocol === "https:" || url.protocol === "wss:" ? 443 : 80)),
    };
  }
  return { host: "127.0.0.1", port: 5080 };
}

export async function inspectPreflight(options = {}) {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? path.resolve("."));
  const nodePath = path.resolve(options.nodePath ?? process.execPath);
  const commandRunner = options.commandRunner ?? runProcess;
  const runtimeKind = options.runtimeKind ?? options.env?.TEAMFORGE_RUNTIME_KIND ??
    process.env.TEAMFORGE_RUNTIME_KIND ?? "external_development";
  const packageManaged = runtimeKind === "bundled_package" || runtimeKind === "installed_package_runtime";
  const npmCliPath = packageManaged ? "" : options.npmCliPath === undefined
    ? await resolveNpmCli({ nodePath, env: options.env ?? process.env })
    : options.npmCliPath;
  const checks = [nodeRuntimeCheck(options.nodeVersion, nodePath)];
  checks.push(packageManaged
    ? check("runtime.npm", PREFLIGHT_CHECK_STATUS.notRequested,
      "Bundled dependencies are package-verified; a package manager is not requested.")
    : await inspectNpm({ nodePath, npmCliPath, commandRunner }));
  checks.push(await inspectWorkspaceLock(workspaceRoot));

  const dependencyTargets = [];
  for (const target of DEPENDENCY_TARGETS) {
    const result = await inspectDependencyTarget(workspaceRoot, target);
    dependencyTargets.push(result);
    checks.push(...result.checks);
  }

  const paths = await inspectPaths(options);
  checks.push(...paths.checks);
  const portProbe = options.portProbe ?? probePort;
  const serverProbe = serverProbeFromOptions(options, paths.launch);
  checks.push(await portProbe({
    ...serverProbe,
    timeoutMilliseconds: options.timeoutMilliseconds,
  }));
  checks.push(await portProbe({
    host: options.seedHost ?? "127.0.0.1",
    port: options.seedPort ?? 0,
    timeoutMilliseconds: options.timeoutMilliseconds,
  }));

  const failures = checks
    .filter((item) => item.status === PREFLIGHT_CHECK_STATUS.fail)
    .map((item) => item.failure);
  return Object.freeze({
    apiVersion: ORCHESTRATOR_API_VERSION,
    operationId: options.operationId ?? randomUUID(),
    operation: "inspect",
    state: failures.length === 0 ? "idle" : "needs_action",
    mutatesLocalState: false,
    mutatesRemoteState: false,
    runtimeStrategy: Object.freeze({
      kind: runtimeKind,
      nodeExecutable: nodePath,
      npmCli: npmCliPath || null,
      bundledRuntime: packageManaged ? "verified_by_package_discovery" : "not_requested",
    }),
    resolved: paths.resolved,
    checks: Object.freeze(checks),
    failures: Object.freeze(failures),
    dependencyTargets: Object.freeze(dependencyTargets),
  });
}

function dependencyFailures(result) {
  return result.checks
    .filter((item) => item.status === PREFLIGHT_CHECK_STATUS.fail)
    .map((item) => item.failure);
}

export async function repairDependencies(options = {}) {
  if (options.confirmRepair !== true) {
    const failure = normalizeOrchestratorFailure({
      code: "operation_cancelled",
      message: "Dependency repair requires explicit confirmation.",
    });
    return Object.freeze({
      apiVersion: ORCHESTRATOR_API_VERSION,
      operationId: options.operationId ?? randomUUID(),
      operation: "repair_dependencies",
      state: "needs_action",
      mutatesLocalState: false,
      mutatesRemoteState: false,
      changed: false,
      repairs: Object.freeze([]),
      failures: Object.freeze([failure]),
    });
  }

  const workspaceRoot = path.resolve(options.workspaceRoot ?? path.resolve("."));
  const operationId = options.operationId ?? randomUUID();
  const nodePath = path.resolve(options.nodePath ?? process.execPath);
  const commandRunner = options.commandRunner ?? runProcess;
  const runtimeKind = options.runtimeKind ?? options.env?.TEAMFORGE_RUNTIME_KIND ??
    process.env.TEAMFORGE_RUNTIME_KIND ?? "external_development";
  const packageManaged = runtimeKind === "bundled_package" || runtimeKind === "installed_package_runtime";
  const npmCliPath = packageManaged ? "" : options.npmCliPath === undefined
    ? await resolveNpmCli({ nodePath, env: options.env ?? process.env })
    : options.npmCliPath;
  const runtimeChecks = [
    nodeRuntimeCheck(options.nodeVersion, nodePath),
    packageManaged
      ? check("runtime.npm", PREFLIGHT_CHECK_STATUS.notRequested,
        "Bundled dependencies are immutable at runtime; a package manager is not requested.")
      : await inspectNpm({ nodePath, npmCliPath, commandRunner }),
    await inspectWorkspaceLock(workspaceRoot),
  ];
  const portProbe = options.portProbe ?? probePort;
  const portChecks = [
    await portProbe({
      host: options.serverHost ?? "127.0.0.1",
      port: options.serverPort ?? 5080,
      timeoutMilliseconds: options.timeoutMilliseconds,
    }),
    await portProbe({
      host: options.seedHost ?? "127.0.0.1",
      port: options.seedPort ?? 0,
      timeoutMilliseconds: options.timeoutMilliseconds,
    }),
  ];
  const guardFailures = [...runtimeChecks, ...portChecks]
    .filter((item) => item.status === PREFLIGHT_CHECK_STATUS.fail)
    .map((item) => item.failure);
  if (guardFailures.length > 0) {
    return Object.freeze({
      apiVersion: ORCHESTRATOR_API_VERSION,
      operationId,
      operation: "repair_dependencies",
      state: "needs_action",
      mutatesLocalState: false,
      mutatesRemoteState: false,
      changed: false,
      repairs: Object.freeze([]),
      checks: Object.freeze([...runtimeChecks, ...portChecks]),
      failures: Object.freeze(guardFailures),
    });
  }

  const before = [];
  for (const target of DEPENDENCY_TARGETS) {
    before.push(await inspectDependencyTarget(workspaceRoot, target));
  }
  const pending = before.filter((target) => !target.ready);
  if (packageManaged && pending.length > 0) {
    const failure = normalizeOrchestratorFailure({
      code: "runtime_bundle_corrupt",
      message: "Bundled TeamForge dependencies failed verification. Reinstall the TeamForge package; runtime repair is disabled.",
    });
    return Object.freeze({
      apiVersion: ORCHESTRATOR_API_VERSION,
      operationId,
      operation: "repair_dependencies",
      state: "needs_action",
      mutatesLocalState: false,
      mutatesRemoteState: false,
      changed: false,
      repairs: Object.freeze([]),
      failures: Object.freeze([failure]),
    });
  }
  const unrepairable = pending.filter((target) => !target.repairable);
  if (unrepairable.length > 0) {
    return Object.freeze({
      apiVersion: ORCHESTRATOR_API_VERSION,
      operationId,
      operation: "repair_dependencies",
      state: "needs_action",
      mutatesLocalState: false,
      mutatesRemoteState: false,
      changed: false,
      repairs: Object.freeze([]),
      failures: Object.freeze(unrepairable.flatMap(dependencyFailures)),
    });
  }
  if (pending.length === 0) {
    return Object.freeze({
      apiVersion: ORCHESTRATOR_API_VERSION,
      operationId,
      operation: "repair_dependencies",
      state: "idle",
      mutatesLocalState: false,
      mutatesRemoteState: false,
      changed: false,
      repairs: Object.freeze([]),
      failures: Object.freeze([]),
    });
  }

  const lockPath = path.join(workspaceRoot, ".teamforge-dependency-repair.lock");
  let lockHandle;
  try {
    lockHandle = await open(lockPath, "wx", 0o600);
    await lockHandle.writeFile(`${JSON.stringify({ operationId, pid: process.pid, startedAt: new Date().toISOString() })}\n`);
  } catch (error) {
    if (lockHandle) {
      await lockHandle.close().catch(() => {});
      await rm(lockPath, { force: true }).catch(() => {});
    }
    const code = error.code === "EEXIST" ? "dependency_repair_in_progress" : "dependency_repair_failed";
    const failure = normalizeOrchestratorFailure({ code, message: "Dependency repair lock could not be acquired." });
    return Object.freeze({
      apiVersion: ORCHESTRATOR_API_VERSION,
      operationId,
      operation: "repair_dependencies",
      state: "needs_action",
      mutatesLocalState: false,
      mutatesRemoteState: false,
      changed: false,
      repairs: Object.freeze([]),
      failures: Object.freeze([failure]),
    });
  }

  const repairs = [];
  let repairFailure = null;
  try {
    for (const target of pending) {
      const result = await commandRunner(nodePath, [npmCliPath, ...REPAIR_ARGUMENTS], { cwd: target.root });
      repairs.push(Object.freeze({
        target: target.target,
        cwd: target.root,
        command: Object.freeze([nodePath, npmCliPath, ...REPAIR_ARGUMENTS]),
        exitCode: result.code,
      }));
      if (result.code !== 0) {
        repairFailure = normalizeOrchestratorFailure({
          code: "dependency_repair_failed",
          message: `Locked dependency repair failed for ${target.target}.`,
        });
        break;
      }
    }
  } finally {
    await lockHandle.close();
    await rm(lockPath, { force: true });
  }

  const after = [];
  for (const target of DEPENDENCY_TARGETS) {
    after.push(await inspectDependencyTarget(workspaceRoot, target));
  }
  const afterFailures = after.flatMap(dependencyFailures);
  const failures = repairFailure ? [repairFailure, ...afterFailures] : afterFailures;
  return Object.freeze({
    apiVersion: ORCHESTRATOR_API_VERSION,
    operationId,
    operation: "repair_dependencies",
    state: failures.length === 0 ? "idle" : "needs_action",
    mutatesLocalState: repairs.length > 0,
    mutatesRemoteState: false,
    changed: repairs.length > 0,
    repairs: Object.freeze(repairs),
    failures: Object.freeze(failures),
  });
}
