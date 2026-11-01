import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

export const environmentRequirements = new Set(["locked-dependencies", "dotnet-sdk", "unity-editor", "windows", "physical-field"]);
const unityVersion = /^\d+\.\d+\.\d+[abfp]\d+$/;

function executable(file, platform) {
  try {
    if (!fs.statSync(file).isFile()) return false;
    fs.accessSync(file, platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK);
    return true;
  } catch { return false; }
}

export function findCommand(command, { env = process.env, platform = process.platform } = {}) {
  if (command === "node") return process.execPath;
  const extensions = platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const directory of (env.PATH ?? env.Path ?? "").split(platform === "win32" ? ";" : path.delimiter)) {
    if (!directory) continue; // Do not implicitly search the current working directory.
    for (const extension of extensions) {
      const candidate = path.resolve(directory, command + extension);
      if (executable(candidate, platform)) return candidate;
    }
  }
  return null;
}

export function defaultUnityRoots({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  if (platform === "win32") {
    return [...new Set([env.ProgramFiles, env["ProgramFiles(x86)"]].filter(Boolean))]
      .map((root) => path.join(root, "Unity", "Hub", "Editor"));
  }
  if (platform === "darwin") return ["/Applications/Unity/Hub/Editor"];
  return [path.join(home, "Unity", "Hub", "Editor"), "/opt/unity/editors", "/opt/Unity/Hub/Editor"];
}

// Discovery never launches an Editor. A directory version is a hint, not proof of
// the executable's version, license, compilation or test results.
export function discoverUnityEditors({ roots, editor, env = process.env, platform = process.platform, home } = {}) {
  const editors = [];
  const issues = [];
  const seen = new Set();
  const add = (file, versionHint, source) => {
    if (!executable(file, platform)) return false;
    let canonical;
    try { canonical = fs.realpathSync(file); } catch { return false; }
    if (!seen.has(canonical)) {
      seen.add(canonical);
      editors.push({ path: path.resolve(file), versionHint, source, versionVerified: false });
    }
    return true;
  };
  const explicit = editor ?? (env.UNITY_EDITOR || undefined);
  if (explicit !== undefined) {
    const versionHint = String(explicit).split(/[\\/]/).find((part) => unityVersion.test(part)) ?? null;
    if (!path.isAbsolute(explicit) || !add(explicit, versionHint, "explicit")) {
      issues.push({ code: "invalid_explicit_editor", message: "The selected Editor must be an accessible absolute executable path; no fallback was selected." });
    }
  }
  for (const root of roots ?? defaultUnityRoots({ env, platform, home })) {
    let entries;
    try { entries = fs.readdirSync(root).sort(); }
    catch (error) {
      if (error.code !== "ENOENT") issues.push({ code: "unity_root_unreadable", root, message: error.code ?? "read_failed" });
      continue;
    }
    for (const version of entries.filter((name) => unityVersion.test(name))) {
      const relative = platform === "darwin" ? ["Unity.app", "Contents", "MacOS", "Unity"]
        : ["Editor", platform === "win32" ? "Unity.exe" : "Unity"];
      try { add(path.join(root, version, ...relative), version, "hub-directory"); }
      catch (error) { issues.push({ code: "unity_candidate_unreadable", root, message: error.code ?? "read_failed" }); }
    }
  }
  return { editors, issues, explicitSelectionInvalid: issues.some((issue) => issue.code === "invalid_explicit_editor") };
}

function supportedNode(version, contract) {
  const parts = version.split(".").map(Number);
  const minimum = contract.minimumVersions[String(parts[0])]?.split(".").map(Number);
  if (!contract.supportedMajors.includes(parts[0]) || !minimum) return false;
  return parts[1] > minimum[1] || (parts[1] === minimum[1] && parts[2] >= minimum[2]);
}

export function inspectEnvironment({ repoRoot, scenario, steps, requirements, unityRoots, editor,
  env = process.env, platform = process.platform, nodeVersion = process.versions.node, home,
  probe = spawnSync } = {}) {
  const contract = JSON.parse(fs.readFileSync(path.join(repoRoot, "release-contract.json"), "utf8"));
  const checks = [];
  const check = (id, status, detail, extra = {}) => checks.push({ id, status, detail, ...extra });
  check("node", supportedNode(nodeVersion, contract.node) ? "available" : "blocked",
    `Node ${nodeVersion}; required minimums are read from release-contract.json.`);
  for (const command of new Set(steps.filter((step) => step.kind === "command").map((step) => step.command))) {
    const resolved = findCommand(command, { env, platform });
    check(`command:${command}`, resolved ? "available" : "blocked", resolved ? "Executable found; command has not been run." : "Executable missing from PATH.", { path: resolved });
  }
  if (requirements.includes("windows")) {
    check("windows", platform === "win32" ? "available" : "blocked", "This scenario requires Windows.");
  }
  if (requirements.includes("physical-field")) {
    for (const command of ["git", "ssh"]) {
      const resolved = findCommand(command, { env, platform });
      check(`field-command:${command}`, resolved ? "available" : "blocked", resolved ? "Executable found; remote connection has not been attempted." : "Physical field tooling is missing from PATH.");
    }
    check("physical-field-setup", "unverified",
      "The owning field runner must validate TEAMFORGE_FIELD_* configuration, including its exact Editor selection, trusted SSH setup and physical Host/Guest topology. This preflight has not checked those values.");
  }
  if (requirements.includes("locked-dependencies")) {
    for (const workspace of ["server", "project-peer"]) {
      let installed = null;
      try {
        const require = createRequire(path.join(repoRoot, workspace, "package.json"));
        installed = JSON.parse(fs.readFileSync(require.resolve("ws/package.json"), "utf8")).version;
      } catch { /* Missing or unreadable package remains a blocked prerequisite. */ }
      check(`dependencies:${workspace}`, installed === contract.ws.version ? "available" : "blocked",
        installed === contract.ws.version ? `ws ${installed} installed (integrity not revalidated).` : "Install locked dependencies with npm run install:all.");
    }
  }
  if (requirements.includes("dotnet-sdk")) {
    const dotnet = findCommand("dotnet", { env, platform });
    const sdkMajor = contract.dotnet.targetFramework.match(/^net(\d+)\./)?.[1];
    const result = dotnet ? probe(dotnet, ["--list-sdks"], { encoding: "utf8", timeout: 5000, maxBuffer: 64 * 1024, windowsHide: true, shell: false, env }) : null;
    const present = result && !result.error && result.status === 0 &&
      result.stdout.split(/\r?\n/).some((line) => new RegExp(`^${sdkMajor}\\.\\d+\\.\\d+ \\[` ).test(line));
    check("dotnet-sdk", present ? "available" : "blocked", present
      ? `.NET ${sdkMajor} SDK found; project restore/build has not been run.`
      : `Install a .NET ${sdkMajor} SDK; missing, failed or timed-out probes cannot establish readiness.`);
  }
  const unity = discoverUnityEditors({ roots: unityRoots, editor, env, platform, home });
  const explicitEditor = editor ?? (env.UNITY_EDITOR || undefined);
  const baselineCandidates = unity.editors.filter((entry) => entry.versionHint === contract.unity.testedEditor &&
    (explicitEditor === undefined || entry.source === "explicit"));
  const unknownExplicitCandidate = unity.editors.some((entry) => entry.source === "explicit" && entry.versionHint === null);
  if (requirements.includes("unity-editor")) {
    check("unity-editor", !unity.explicitSelectionInvalid && (baselineCandidates.length > 0 || unknownExplicitCandidate) ? "unverified" : "blocked",
      `Baseline ${contract.unity.testedEditor}: discovery does not verify the binary version, license, compilation or EditMode tests.`);
  }
  const external = steps.filter((step) => step.kind !== "command").map((step) => ({ id: step.id, kind: step.kind, reference: step.reference, status: "not-run", reason: step.reason }));
  const status = checks.some((entry) => entry.status === "blocked") ? "blocked"
    : external.length > 0 || checks.some((entry) => entry.status === "unverified") ? "incomplete" : "ready";
  return {
    schemaVersion: 1, scenario, status, evidenceClass: "environment-preflight", testsExecuted: false,
    checks, unity: { baseline: contract.unity.testedEditor, packageLine: contract.unity.packageLine, ...unity },
    external, limitations: ["READY describes checked prerequisites only; run the scenario to collect test evidence.",
      "Editor folder names are unverified version hints. Other discovered versions are not new support claims.",
      "No Editor, server, project copy, package or physical two-PC test was launched."],
  };
}
