import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const live = process.argv.includes("--live");

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function markdownSection(text, heading) {
  const escaped = escapeRegExp(heading);
  const match = new RegExp(`^## ${escaped}\\s*$([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "mu").exec(text);
  assert(match, `Missing required section: ## ${heading}`);
  return match[1];
}

function unwrapMarkdown(value) {
  let result = value.trim();
  if (result.startsWith("**") && result.endsWith("**")) result = result.slice(2, -2).trim();
  if (result.startsWith("`") && result.endsWith("`")) result = result.slice(1, -1).trim();
  return result;
}

function bulletValue(section, label) {
  const escaped = escapeRegExp(label);
  const match = new RegExp(`^- ${escaped}:\\s*(.+?)\\s*$`, "mu").exec(section);
  assert(match, `Missing published-candidate field in builds/README.md: ${label}`);
  return unwrapMarkdown(match[1]);
}

const [buildsReadme, status] = await Promise.all([
  readFile(join(root, "builds", "README.md"), "utf8"),
  readFile(join(root, "docs", "STATUS.md"), "utf8"),
]);

const candidateSection = markdownSection(buildsReadme, "Current published candidate");
const statusSummary = markdownSection(status, "Current state at a glance");

const candidate = {
  productVersion: bulletValue(candidateSection, "Product version"),
  releaseIdentity: bulletValue(candidateSection, "Release identity"),
  tag: bulletValue(candidateSection, "GitHub Release tag"),
  sourceCommit: bulletValue(candidateSection, "Source/tag commit used for publication").toLowerCase(),
  filename: bulletValue(candidateSection, "File"),
  sha256: bulletValue(candidateSection, "SHA-256").toLowerCase(),
};

assert.match(candidate.productVersion, /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u,
  "Published candidate Product version must be semver-like.");
assert.match(candidate.releaseIdentity, /^[0-9A-Za-z][0-9A-Za-z._-]*$/u,
  "Published candidate Release identity contains unexpected characters.");
assert.match(candidate.tag, /^v[0-9A-Za-z][0-9A-Za-z._-]*$/u,
  "Published candidate GitHub Release tag is malformed.");
assert.match(candidate.sourceCommit, /^[0-9a-f]{40}$/u,
  "Published candidate source commit must be an exact 40-character Git commit SHA.");
assert.match(candidate.filename, /^Unity-TeamForge-[^/\\]+\.zip$/u,
  "Published candidate filename must be one TeamForge ZIP basename.");
assert.match(candidate.sha256, /^[0-9a-f]{64}$/u,
  "Published candidate SHA-256 must be an exact 64-character lowercase/uppercase hex digest.");

for (const [label, value] of [
  ["GitHub Release tag", candidate.tag],
  ["source commit", candidate.sourceCommit],
  ["ZIP filename", candidate.filename],
  ["SHA-256", candidate.sha256],
]) {
  assert(statusSummary.toLowerCase().includes(value.toLowerCase()),
    `docs/STATUS.md current-state summary is stale: it does not contain the builds/README.md ${label} (${value}).`);
}

console.log(`Published candidate repository metadata agrees: ${candidate.tag} / ${candidate.filename}.`);

if (live) {
  const repository = process.env.GITHUB_REPOSITORY || "Eun-si123/teamforge-unity-collab";
  assert.match(repository, /^[^/\s]+\/[^/\s]+$/u, `Invalid GITHUB_REPOSITORY value: ${repository}`);

  const apiBase = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/u, "");
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "TeamForge-published-candidate-drift-validator",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  async function githubApi(pathname) {
    const response = await fetch(`${apiBase}${pathname}`, { headers });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitHub API ${response.status} for ${pathname}: ${body.slice(0, 500)}`);
    }
    return response.json();
  }

  const releases = await githubApi(`/repos/${repository}/releases?per_page=100`);
  assert(Array.isArray(releases), "GitHub Releases API did not return an array.");

  const packagedCandidates = releases
    .filter((release) => !release.draft && release.prerelease && Array.isArray(release.assets) &&
      release.assets.some((asset) => /^Unity-TeamForge-.+\.zip$/u.test(asset.name || "")))
    .sort((left, right) => new Date(right.published_at || 0).getTime() - new Date(left.published_at || 0).getTime());

  assert(packagedCandidates.length > 0,
    "No published TeamForge pre-release with a Unity-TeamForge-*.zip asset was found.");

  const latest = packagedCandidates[0];
  assert.equal(latest.tag_name, candidate.tag,
    `Published-candidate drift: builds/README.md records ${candidate.tag}, but the newest packaged GitHub pre-release is ${latest.tag_name}.`);

  let liveSourceCommit = String(latest.target_commitish || "").toLowerCase();
  if (!/^[0-9a-f]{40}$/u.test(liveSourceCommit)) {
    const resolved = await githubApi(`/repos/${repository}/commits/${encodeURIComponent(String(latest.target_commitish || ""))}`);
    liveSourceCommit = String(resolved.sha || "").toLowerCase();
  }
  assert.equal(liveSourceCommit, candidate.sourceCommit,
    `Published-candidate drift: ${candidate.tag} targets ${liveSourceCommit}, but builds/README.md records ${candidate.sourceCommit}.`);

  const zipAsset = latest.assets.find((asset) => asset.name === candidate.filename);
  assert(zipAsset,
    `Published-candidate drift: ${candidate.tag} does not contain the recorded ZIP asset ${candidate.filename}.`);
  assert.equal(String(zipAsset.digest || "").toLowerCase(), `sha256:${candidate.sha256}`,
    `Published-candidate drift: GitHub reports ${zipAsset.digest || "no digest"} for ${candidate.filename}, but builds/README.md records sha256:${candidate.sha256}.`);

  const sidecar = latest.assets.find((asset) => asset.name === `${candidate.filename}.sha256`);
  assert(sidecar,
    `Published-candidate drift: ${candidate.tag} is missing the expected ${candidate.filename}.sha256 sidecar.`);

  console.log(`Live GitHub Release metadata agrees: ${latest.tag_name} @ ${liveSourceCommit}, sha256:${candidate.sha256}.`);
}
