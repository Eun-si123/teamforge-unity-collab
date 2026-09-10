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

const [candidateText, buildsReadme, status] = await Promise.all([
  readFile(join(root, "builds", "published-candidate.json"), "utf8"),
  readFile(join(root, "builds", "README.md"), "utf8"),
  readFile(join(root, "docs", "STATUS.md"), "utf8"),
]);

const candidate = JSON.parse(candidateText);
assert.equal(candidate.schemaVersion, 1, "builds/published-candidate.json schemaVersion must be 1.");
assert.match(candidate.productVersion, /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u,
  "Published candidate Product version must be semver-like.");
assert.match(candidate.releaseIdentity, /^[0-9A-Za-z][0-9A-Za-z._-]*$/u,
  "Published candidate Release identity contains unexpected characters.");
assert.match(candidate.tag, /^v[0-9A-Za-z][0-9A-Za-z._-]*$/u,
  "Published candidate GitHub Release tag is malformed.");
assert.match(candidate.sourceCommit, /^[0-9a-f]{40}$/u,
  "Published candidate source commit must be an exact 40-character lowercase Git commit SHA.");
assert.match(candidate.filename, /^Unity-TeamForge-[^/\\]+\.zip$/u,
  "Published candidate filename must be one TeamForge ZIP basename.");
assert.match(candidate.sha256, /^[0-9a-f]{64}$/u,
  "Published candidate SHA-256 must be an exact 64-character lowercase hex digest.");

const candidateSection = markdownSection(buildsReadme, "Current published candidate");
const statusSummary = markdownSection(status, "Current state at a glance");

for (const [surface, text, fields] of [
  ["builds/README.md Current published candidate", candidateSection, [
    ["product version", candidate.productVersion],
    ["release identity", candidate.releaseIdentity],
    ["GitHub Release tag", candidate.tag],
    ["source commit", candidate.sourceCommit],
    ["ZIP filename", candidate.filename],
    ["SHA-256", candidate.sha256],
  ]],
  ["docs/STATUS.md Current state at a glance", statusSummary, [
    ["GitHub Release tag", candidate.tag],
    ["source commit", candidate.sourceCommit],
    ["ZIP filename", candidate.filename],
    ["SHA-256", candidate.sha256],
  ]],
]) {
  for (const [label, value] of fields) {
    assert(text.toLowerCase().includes(value.toLowerCase()),
      `${surface} is stale: it does not contain published-candidate ${label} (${value}).`);
  }
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
    `Published-candidate drift: builds/published-candidate.json records ${candidate.tag}, but the newest packaged GitHub pre-release is ${latest.tag_name}.`);

  let liveSourceCommit = String(latest.target_commitish || "").toLowerCase();
  if (!/^[0-9a-f]{40}$/u.test(liveSourceCommit)) {
    const resolved = await githubApi(`/repos/${repository}/commits/${encodeURIComponent(String(latest.target_commitish || ""))}`);
    liveSourceCommit = String(resolved.sha || "").toLowerCase();
  }
  assert.equal(liveSourceCommit, candidate.sourceCommit,
    `Published-candidate drift: ${candidate.tag} targets ${liveSourceCommit}, but builds/published-candidate.json records ${candidate.sourceCommit}.`);

  const zipAsset = latest.assets.find((asset) => asset.name === candidate.filename);
  assert(zipAsset,
    `Published-candidate drift: ${candidate.tag} does not contain the recorded ZIP asset ${candidate.filename}.`);
  assert.equal(String(zipAsset.digest || "").toLowerCase(), `sha256:${candidate.sha256}`,
    `Published-candidate drift: GitHub reports ${zipAsset.digest || "no digest"} for ${candidate.filename}, but builds/published-candidate.json records sha256:${candidate.sha256}.`);

  const sidecar = latest.assets.find((asset) => asset.name === `${candidate.filename}.sha256`);
  assert(sidecar,
    `Published-candidate drift: ${candidate.tag} is missing the expected ${candidate.filename}.sha256 sidecar.`);

  console.log(`Live GitHub Release metadata agrees: ${latest.tag_name} @ ${liveSourceCommit}, sha256:${candidate.sha256}.`);
}
