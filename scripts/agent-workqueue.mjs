// Read-only, fail-closed GitHub Issue/PR triage for TeamForge agents.
// NOT an atomic distributed lock and NOT permission to run unattended or merge.
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const PRIORITIES = ["p0", "p1", "p2", "p3"];
const READINESS = ["agent-ready", "needs-decision", "needs-field-test", "blocked", "triage"];
const CLAIM_RE = /<!--\s*teamforge-agent-(claim|release)-v1\s+(\{[^\r\n]*\})\s*-->/gu;
const TASK_RE = /<!--\s*teamforge-task-v1\s+(\{[^\r\n]*\})\s*-->/gu;
const MAX_LEASE_MS = 6 * 60 * 60 * 1000;
const API_PAGE_LIMIT = 5;

function asMetadata(body = "", labels = []) {
  const matches = [...String(body).matchAll(TASK_RE)];
  const ownLabels = labels.map(x => typeof x === "string" ? x : x.name).filter(Boolean);
  let raw = {};
  let malformed = matches.length > 1;
  if (matches.length === 1) {
    try { raw = JSON.parse(matches[0][1]); }
    catch { malformed = true; }
  }
  const labelPriority = PRIORITIES.filter(p => ownLabels.includes("priority:" + p));
  const labelReadiness = READINESS.filter(s => ownLabels.includes("agent:" + s));
  if (labelPriority.length > 1 || labelReadiness.length > 1) malformed = true;
  if (raw.priority && labelPriority.length && raw.priority !== labelPriority[0]) malformed = true;
  if (raw.readiness && labelReadiness.length && raw.readiness !== labelReadiness[0]) malformed = true;
  const priority = labelPriority[0] || raw.priority || "untriaged";
  const readiness = labelReadiness[0] || raw.readiness || "triage";
  const area = raw.area || "unspecified";
  if (![...PRIORITIES, "untriaged"].includes(priority) ||
      !READINESS.includes(readiness) || typeof area !== "string" ||
      !/^[a-z][a-z0-9-]{0,35}$/u.test(area)) malformed = true;
  return Object.freeze({ priority: malformed ? "untriaged" : priority,
    readiness: malformed ? "triage" : readiness,
    area: malformed ? "unspecified" : area, metadataConflict: malformed });
}

export function linkedPullRequests(issue, pulls = []) {
  const number = issue.number;
  const reference = new RegExp("(^|[^0-9])#" + number + "(?![0-9])|/issues/" + number + "(?![0-9])", "u");
  return pulls.filter(p => p.state === "open" && reference.test(String(p.title || "") + "\n" + String(p.body || "")))
    .map(p => ({ number: p.number, url: p.html_url || p.url, branch: p.head?.ref || "unknown" }));
}

export function planQueue(issues = [], pulls = []) {
  return issues.filter(i => !i.pull_request && i.state === "open").map(i => {
    const metadata = asMetadata(i.body, i.labels || []);
    const activePRs = linkedPullRequests(i, pulls);
    // A plan never grants a claim. Lack of an Issue label is UNKNOWN, not low priority.
    const candidate = !metadata.metadataConflict && metadata.readiness === "agent-ready" &&
      metadata.priority !== "untriaged" && activePRs.length === 0;
    return { issue: i.number, title: i.title, url: i.html_url || i.url, ...metadata,
      activePRs, selection: candidate ? "CHECK_CLAIMS_BEFORE_WORK" : "NOT_AUTO_SELECTABLE" };
  }).sort((a, b) => {
    const score = i => PRIORITIES.indexOf(i.priority) < 0 ? 4 : PRIORITIES.indexOf(i.priority);
    return score(a) - score(b) || a.issue - b.issue;
  });
}

export function evaluateClaims(comments = [], nowIso = new Date().toISOString()) {
  const now = Date.parse(nowIso);
  if (!Number.isFinite(now)) throw Error("Invalid comparison time.");
  const byBranch = new Map();
  let rejectedEvents = 0;
  const sorted = [...comments].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id);
  for (const comment of sorted) {
    for (const match of String(comment.body || "").matchAll(CLAIM_RE)) {
      let event;
      try { event = JSON.parse(match[2]); }
      catch { rejectedEvents++; continue; }
      const branch = event.branch, actor = event.agent, expiry = Date.parse(event.expiresAt);
      const created = Date.parse(comment.created_at);
      if (typeof branch !== "string" || !/^agent\/[A-Za-z0-9._/-]{3,110}$/u.test(branch) ||
          branch.includes("..") || branch.includes("//") ||
          typeof actor !== "string" || !/^[A-Za-z0-9._-]{2,80}$/u.test(actor) ||
          !Number.isFinite(created) || !Number.isFinite(expiry) ||
          expiry <= created || expiry - created > MAX_LEASE_MS) {
        rejectedEvents++; continue;
      }
      const previous = byBranch.get(branch);
      if (match[1] === "release") {
        if (previous && previous.agent === actor && previous.created < created) byBranch.delete(branch);
      } else {
        // A comment is an advisory coordination signal, not an authenticated lease.
        byBranch.set(branch, { branch, agent: actor, created, expiresAt: event.expiresAt,
          commentUrl: comment.html_url || null });
      }
    }
  }
  const activeClaims = [...byBranch.values()].filter(c => Date.parse(c.expiresAt) > now)
    .map(({ branch, agent, expiresAt, commentUrl }) => ({ branch, agent, expiresAt, commentUrl }));
  return { activeClaims, rejectedEvents, exclusiveOwnershipGuaranteed: false };
}

export function checkIssue(issue, pulls, comments, nowIso) {
  if (!issue || !Number.isInteger(issue.number) || issue.state !== "open" || issue.pull_request) {
    throw Error("Expected an open GitHub Issue.");
  }
  const row = planQueue([issue], pulls)[0];
  const claimState = evaluateClaims(comments, nowIso);
  return { ...row, ...claimState,
    result: row.selection !== "CHECK_CLAIMS_BEFORE_WORK" || claimState.rejectedEvents
      ? "NOT_READY_OR_UNCERTAIN"
      : row.activePRs.length || claimState.activeClaims.length
        ? "CONFLICT_OR_OWNED"
        : "NO_CLAIM_OBSERVED_RECHECK_AND_CONFIRM",
    warning: "GitHub Issue comments are non-atomic advisory signals. A second agent can race; never infer an exclusive lock." };
}

function repoName(value) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(value)) throw Error("Expected owner/repo.");
  return value;
}
async function fetchJson(repo, path) {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "teamforge-agent-workqueue" };
  if (process.env.GITHUB_TOKEN || process.env.GH_TOKEN) {
    headers.Authorization = "Bearer " + (process.env.GITHUB_TOKEN || process.env.GH_TOKEN);
  }
  const response = await fetch("https://api.github.com/repos/" + repo + "/" + path, {
    headers, signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw Error("GitHub read failed (HTTP " + response.status + "). No claim can be inferred.");
  return response.json();
}
async function fetchPages(repo, path) {
  const items = [];
  for (let page = 1; page <= API_PAGE_LIMIT; page++) {
    const response = await fetchJson(repo, path + (path.includes("?") ? "&" : "?") + "per_page=100&page=" + page);
    if (!Array.isArray(response)) throw Error("Unexpected GitHub list response; refusing stale selection.");
    items.push(...response);
    if (response.length < 100) return items;
  }
  throw Error("GitHub list exceeded bounded page budget; refusing incomplete selection.");
}
function flag(args, name, fallback) {
  const idx = args.indexOf(name);
  if (idx < 0) return fallback;
  if (!args[idx + 1] || args[idx + 1].startsWith("--")) throw Error("Missing value after " + name);
  return args[idx + 1];
}

export async function runCli(args) {
  const command = args[0] || "plan";
  if (command !== "plan" && command !== "check") throw Error("Use plan or check.");
  const repo = repoName(flag(args, "--repo", "Eun-si123/teamforge-unity-collab"));
  const fixturePath = flag(args, "--fixture", null);
  const fixture = fixturePath ? JSON.parse(await readFile(fixturePath, "utf8")) : null;
  const issues = fixture ? fixture.issues : await fetchPages(repo, "issues?state=open");
  const pulls = fixture ? fixture.pulls : await fetchPages(repo, "pulls?state=open");
  let result;
  if (command === "plan") {
    result = { repository: repo, observed: "live-or-fixture-READ_ONLY", issues: planQueue(issues, pulls),
      warning: "Priority/readiness are metadata, not proof. Run check on any candidate immediately before an explicit claim." };
  } else {
    const raw = flag(args, "--issue", null);
    const number = Number(raw);
    if (!raw || !Number.isSafeInteger(number) || number < 1) throw Error("check requires --issue <positive integer>.");
    const issue = fixture ? issues.find(i => i.number === number) : await fetchJson(repo, "issues/" + number);
    const comments = fixture ? fixture.comments?.[String(number)] || [] :
      await fetchPages(repo, "issues/" + number + "/comments");
    result = { repository: repo, observed: "live-or-fixture-READ_ONLY",
      check: checkIssue(issue, pulls, comments, fixture?.now) };
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await runCli(process.argv.slice(2));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("Agent workqueue: " + error.message + " (fail closed; do not self-assign)");
    process.exitCode = 1;
  }
}
