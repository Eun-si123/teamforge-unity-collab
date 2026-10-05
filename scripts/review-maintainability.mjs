#!/usr/bin/env node

import { appendFile } from "node:fs/promises";
import { extname, posix, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const thresholds = Object.freeze({
  cohesionReviewLines: 800,
  strongExtractionLines: 1200,
  broadProductionFiles: 15,
  broadAddedLines: 1000,
  tinyFileLines: 100,
  tinyFileBurst: 5,
});

const SOURCE_EXTENSIONS = new Set([".cs", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".xaml"]);
const FRAGMENTATION_EXTENSIONS = new Set([".cs", ".js", ".mjs", ".cjs", ".ts", ".tsx"]);
const GENERATED_SEGMENTS = new Set([
  "node_modules", "Library", "Temp", "obj", "bin", "dist", "build", "builds", "coverage", ".gradle", ".cache",
]);

function normalize(path) {
  return path.replaceAll("\\", "/").replace(/^\.\//u, "");
}

export function isProductionSource(path) {
  const normalized = normalize(path);
  const extension = extname(normalized).toLowerCase();
  if (!SOURCE_EXTENSIONS.has(extension)) return false;

  const segments = normalized.split("/");
  if (segments.some((segment) => GENERATED_SEGMENTS.has(segment))) return false;

  const lower = `/${normalized.toLowerCase()}`;
  if (lower.includes("/test/") || lower.includes("/tests/") || lower.includes("/test-support/")) return false;
  if (/(?:^|\/)[^/]*(?:\.test|\.spec|test|tests|spec)\.(?:cs|mjs|cjs|js|ts|tsx)$/iu.test(normalized)) return false;
  if (/\.(?:g|generated|designer)\.cs$/iu.test(normalized)) return false;
  return true;
}

export function isFragmentationCandidate(path) {
  return isProductionSource(path) && FRAGMENTATION_EXTENSIONS.has(extname(normalize(path)).toLowerCase());
}

export function evaluate(changes) {
  const findings = [];
  const production = changes.filter((change) => isProductionSource(change.path));
  const totalAdditions = production.reduce((sum, change) => sum + change.additions, 0);

  if (production.length >= thresholds.broadProductionFiles || totalAdditions >= thresholds.broadAddedLines) {
    findings.push({
      kind: "scope",
      message: `Broad production-code change: ${production.length} files and ${totalAdditions} added lines. Re-check that the PR still has one cohesive objective. Keep correctness/security prerequisites in scope, but move independent discoveries to follow-up work instead of extending an open PR indefinitely.`,
    });
  }

  for (const change of production) {
    const growth = change.additions - change.deletions;
    if (growth <= 0) continue;
    if (change.lines >= thresholds.strongExtractionLines) {
      findings.push({
        kind: "large-file",
        path: change.path,
        message: `Already-large source grew to ${change.lines} lines (+${growth} net). This is a strong extraction signal: check whether the new behavior has its own stable owner, lifecycle, dependency boundary, or test seam. Do not split only to reduce line count.`,
      });
    } else if (change.lines >= thresholds.cohesionReviewLines) {
      findings.push({
        kind: "large-file",
        path: change.path,
        message: `Source grew to ${change.lines} lines (+${growth} net). Review cohesion before adding more unrelated behavior. The line count is a review trigger, not a CI limit.`,
      });
    }
  }

  const tinyByDirectory = new Map();
  for (const change of production) {
    if (!change.isNew || change.lines > thresholds.tinyFileLines || !isFragmentationCandidate(change.path)) continue;
    const directory = posix.dirname(normalize(change.path));
    const group = tinyByDirectory.get(directory) || [];
    group.push(change);
    tinyByDirectory.set(directory, group);
  }
  for (const [directory, files] of [...tinyByDirectory.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (files.length < thresholds.tinyFileBurst) continue;
    const names = files.slice(0, 6).map((file) => posix.basename(file.path)).join(", ");
    findings.push({
      kind: "fragmentation",
      message: `${files.length} small production files were added under ${directory} (${names}). C# one-type-per-file is normal, so this is only a review signal: verify each file has a stable responsibility. If understanding one operation now requires opening many tiny wrappers/helpers, fold them into the cohesive owner or introduce a meaningful component/package boundary.`,
    });
  }

  return findings;
}

function git(args, { allowFailure = false, encoding = "utf8" } = {}) {
  const result = spawnSync("git", args, { encoding });
  if (!allowFailure && result.status !== 0) {
    throw new Error((result.stderr || "").toString().trim() || `git ${args.join(" ")} failed`);
  }
  return result;
}

function validCommit(ref) {
  if (!ref) return false;
  return git(["cat-file", "-e", `${ref}^{commit}`], { allowFailure: true }).status === 0;
}

function resolveBase(base, head) {
  if (validCommit(base)) return base;
  const parent = git(["rev-parse", `${head}^`], { allowFailure: true }).stdout?.trim();
  return parent && validCommit(parent) ? parent : head;
}

function countLinesAt(ref, path) {
  const result = git(["show", `${ref}:${path}`], { allowFailure: true, encoding: null });
  if (result.status !== 0) return 0;
  const buffer = result.stdout || Buffer.alloc(0);
  if (buffer.length === 0) return 0;
  let lines = 0;
  for (const byte of buffer) if (byte === 10) lines += 1;
  return buffer.at(-1) === 10 ? lines : lines + 1;
}

function statsFor(base, head, path) {
  const output = git(["diff", "--numstat", base, head, "--", path], { allowFailure: true }).stdout?.trim();
  if (!output) return { additions: 0, deletions: 0 };
  const [added, deleted] = output.split("\n", 1)[0].split("\t", 3);
  if (added === "-" || deleted === "-") return { additions: 0, deletions: 0 };
  return { additions: Number(added) || 0, deletions: Number(deleted) || 0 };
}

export function collectChanges(base, head) {
  const effectiveBase = resolveBase(base, head);
  const paths = git([
    "diff", "--name-only", "--diff-filter=ACMR", effectiveBase, head, "--",
    "*.cs", "*.js", "*.mjs", "*.cjs", "*.ts", "*.tsx", "*.xaml",
  ]).stdout.split(/\r?\n/u).filter(Boolean);
  const newPaths = new Set(git([
    "diff", "--name-only", "--diff-filter=A", effectiveBase, head, "--",
    "*.cs", "*.js", "*.mjs", "*.cjs", "*.ts", "*.tsx", "*.xaml",
  ]).stdout.split(/\r?\n/u).filter(Boolean));

  return {
    base: effectiveBase,
    head,
    changes: paths.map((path) => ({
      path,
      lines: countLinesAt(head, path),
      ...statsFor(effectiveBase, head, path),
      isNew: newPaths.has(path),
    })),
  };
}

function parseArgs(argv) {
  const result = { base: "", head: "HEAD" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--base") result.base = argv[++index] || "";
    else if (arg === "--head") result.head = argv[++index] || "HEAD";
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return result;
}

async function emit(findings, diff) {
  const lines = [];
  if (findings.length === 0) {
    lines.push("Maintainability review: no growth signals triggered.");
  } else {
    lines.push(`Maintainability review: ${findings.length} warning(s). These are review signals, not CI failures.`);
    for (const finding of findings) {
      if (process.env.GITHUB_ACTIONS === "true") {
        const location = finding.path ? ` file=${finding.path}` : "";
        console.log(`::warning${location}::${finding.message}`);
      } else {
        console.warn(`WARNING: ${finding.path ? `${finding.path}: ` : ""}${finding.message}`);
      }
      lines.push(`- ${finding.path ? `\`${finding.path}\`: ` : ""}${finding.message}`);
    }
  }
  console.log(lines[0]);

  if (process.env.GITHUB_STEP_SUMMARY) {
    const summary = [
      "## Maintainability review",
      "",
      `- Diff: \`${diff.base}\` → \`${diff.head}\``,
      `- Production source files inspected in diff: ${diff.changes.filter((change) => isProductionSource(change.path)).length}`,
      `- Warning signals: ${findings.length}`,
      "",
      ...(findings.length ? lines.slice(1) : ["No growth signals triggered."]),
      "",
      "These signals are intentionally warning-only. They should trigger a cohesion/scope review, not line-count-driven refactoring.",
      "",
    ].join("\n");
    await appendFile(process.env.GITHUB_STEP_SUMMARY, summary, "utf8");
  }
}

async function main() {
  const { base, head } = parseArgs(process.argv.slice(2));
  const diff = collectChanges(base, head);
  const findings = evaluate(diff.changes);
  await emit(findings, diff);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url)) : false;
if (invokedPath) {
  main().catch((error) => {
    console.error(`Maintainability review could not inspect the diff: ${error.message}`);
    process.exitCode = 2;
  });
}
