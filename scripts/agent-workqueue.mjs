// Read-only, fail-closed GitHub Issue/PR triage for TeamForge agents.
// NOT an atomic distributed lock and NOT permission to run unattended or merge.
import { appendFile, readFile, writeFile } from "node:fs/promises";
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
    try {
      const parsed = JSON.parse(matches[0][1]);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) malformed = true;
      else raw = parsed;
    } catch { malformed = true; }
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

// Audit reports are observations, never a work dispatch or atomic lease.
export function summarizeAudit(issues, pulls, commentsByIssue = {}, nowIso = new Date().toISOString()) {
  const rows = planQueue(issues, pulls);
  const checked = rows.map(row => {
    if (row.selection !== "CHECK_CLAIMS_BEFORE_WORK") {
      return { ...row, result: "NOT_READY_OR_UNCERTAIN" };
    }
    const comments = commentsByIssue[String(row.issue)];
    if (!Array.isArray(comments)) return { ...row, result: "CLAIM_CHECK_MISSING_FAIL_CLOSED" };
    return checkIssue(issues.find(i => i.number === row.issue), pulls, comments, nowIso);
  });
  const counts = {
    openIssues: checked.length,
    classified: checked.filter(r => r.priority !== "untriaged" && !r.metadataConflict).length,
    triageOrBlocked: checked.filter(r => r.selection !== "CHECK_CLAIMS_BEFORE_WORK").length,
    claimChecksPerformed: checked.filter(r => r.selection === "CHECK_CLAIMS_BEFORE_WORK" &&
      r.result !== "CLAIM_CHECK_MISSING_FAIL_CLOSED").length,
    noClaimObserved: checked.filter(r => r.result === "NO_CLAIM_OBSERVED_RECHECK_AND_CONFIRM").length,
    activeOrConflicting: checked.filter(r => r.result === "CONFLICT_OR_OWNED").length,
    uncertain: checked.filter(r => r.result === "CLAIM_CHECK_MISSING_FAIL_CLOSED" ||
      (r.selection === "CHECK_CLAIMS_BEFORE_WORK" && r.result === "NOT_READY_OR_UNCERTAIN")).length,
  };
  return { observedAt: nowIso, mode: "READ_ONLY_NO_WORK_DISPATCH", counts, issues: checked,
    warning: "A GitHub Actions audit does not execute an LLM or assign tasks. GitHub comments are not atomic leases." };
}

function safeMarkdown(value) {
  return String(value ?? "").replace(/[\r\n|<>\[\]]/gu, " ").replace(/\s+/gu, " ").slice(0, 140);
}
export function auditMarkdown(report) {
  const c = report.counts;
  const lines = [
    "## TeamForge agent work queue — read-only audit",
    "",
    "Observed (UTC): " + safeMarkdown(report.observedAt),
    "",
    "| Open Issues | Classified | Needs triage/decision/field work | Claim checks | No claim observed | Active/conflicting | Uncertain |",
    "| ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    "| " + [c.openIssues, c.classified, c.triageOrBlocked, c.claimChecksPerformed,
      c.noClaimObserved, c.activeOrConflicting, c.uncertain].join(" | ") + " |",
    "",
    "**This run does not claim an issue, modify code, start an AI developer or authorize merges.**",
    "Even NO_CLAIM_OBSERVED is not an exclusive lock; validate current source and claims again before user-authorized work.",
    "",
    "| Issue | Priority | Readiness | Result |",
    "| --- | --- | --- | --- |",
  ];
  for (const row of report.issues) {
    lines.push("| #" + row.issue + " " + safeMarkdown(row.title) + " | " +
      row.priority + " | " + row.readiness + " | " + row.result + " |");
  }
  return lines.join("\n") + "\n";
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
  if (!["plan", "check", "audit"].includes(command)) throw Error("Use plan, check or audit.");
  const repo = repoName(flag(args, "--repo", "Eun-si123/teamforge-unity-collab"));
  const fixturePath = flag(args, "--fixture", null);
  const fixture = fixturePath ? JSON.parse(await readFile(fixturePath, "utf8")) : null;
  const issues = fixture ? fixture.issues : await fetchPages(repo, "issues?state=open");
  const pulls = fixture ? fixture.pulls : await fetchPages(repo, "pulls?state=open");
  let result;
  if (command === "audit") {
    const numbers = planQueue(issues, pulls).filter(row =>
      row.selection === "CHECK_CLAIMS_BEFORE_WORK").map(row => row.issue);
    const comments = {};
    for (const number of numbers) {
      comments[String(number)] = fixture ? fixture.comments?.[String(number)] || [] :
        await fetchPages(repo, "issues/" + number + "/comments");
    }
    result = { repository: repo, source: fixture ? "OFFLINE_FIXTURE" : "LIVE_GITHUB",
      ...summarizeAudit(issues, pulls, comments, fixture?.now || new Date().toISOString()) };
  } else if (command === "plan") {
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
  if (command === "audit") {
    const output = flag(args, "--output", null);
    const summary = flag(args, "--summary", null);
    if (output) await writeFile(output, JSON.stringify(result, null, 2) + "\n", { flag: "w" });
    if (summary) await appendFile(summary, auditMarkdown(result), { flag: "a" });
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
