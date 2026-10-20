import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { auditMarkdown, checkIssue, evaluateClaims, linkedPullRequests, planQueue, runCli, summarizeAudit } from "./agent-workqueue.mjs";

const makeIssue = (number, body = "", labels = []) => ({
  number, state: "open", title: "Issue " + number, html_url: "https://github.com/example/repo/issues/" + number,
  body, labels: labels.map(name => ({ name })),
});
const marker = (priority = "p1", readiness = "agent-ready") =>
  "<!-- teamforge-task-v1 " + JSON.stringify({ priority, readiness, area: "unity" }) + " -->";
const time = "2026-10-20T11:00:00.000Z";
const claim = (kind, branch = "agent/wp6-safe-task", expiresAt = "2026-10-20T12:00:00.000Z") =>
  ({ id: kind === "claim" ? 1 : 2, created_at: kind === "claim" ? "2026-10-20T10:00:00.000Z" : "2026-10-20T10:15:00.000Z",
     body: "<!-- teamforge-agent-" + kind + "-v1 " + JSON.stringify({ agent: "runner-1", branch, expiresAt }) + " -->" });

test("unclassified GitHub issues are never automatically selected", () => {
  const rows = planQueue([makeIssue(3), makeIssue(4, marker())], []);
  assert.deepEqual(rows.map(x => x.issue), [4, 3]);
  assert.equal(rows[0].selection, "CHECK_CLAIMS_BEFORE_WORK");
  assert.equal(rows[1].priority, "untriaged");
  assert.equal(rows[1].selection, "NOT_AUTO_SELECTABLE");
});
test("conflicting priority labels or body metadata fail closed", () => {
  const item = makeIssue(7, marker(), ["priority:p0", "agent:agent-ready"]);
  assert.equal(planQueue([item])[0].selection, "NOT_AUTO_SELECTABLE");
  assert.equal(planQueue([item])[0].metadataConflict, true);
});
test("linked PR blocks selection; unrelated issue numbers do not match", () => {
  const issue = makeIssue(30, marker());
  const pulls = [{ number: 4, state: "open", title: "Fixes #300", body: "Other", head: { ref: "agent/other" } },
    { number: 5, state: "open", title: "Fixes #30", body: "", head: { ref: "agent/same" } }];
  assert.equal(linkedPullRequests(issue, pulls).length, 1);
  assert.equal(planQueue([issue], pulls)[0].selection, "NOT_AUTO_SELECTABLE");
});
test("active claim signals conflict, release clears same-agent lease", () => {
  const issue = makeIssue(30, marker());
  const owned = checkIssue(issue, [], [claim("claim")], time);
  assert.equal(owned.result, "CONFLICT_OR_OWNED");
  assert.equal(owned.exclusiveOwnershipGuaranteed, false);
  const released = checkIssue(issue, [], [claim("claim"), claim("release")], time);
  assert.equal(released.result, "NO_CLAIM_OBSERVED_RECHECK_AND_CONFIRM");
});
test("expired claims don't imply exclusivity and invalid leases are flagged", () => {
  assert.equal(evaluateClaims([claim("claim")], "2026-10-20T13:00:00.000Z").activeClaims.length, 0);
  const tooLong = claim("claim", "agent/wp6-safe-task", "2026-10-21T12:00:00Z");
  assert.equal(evaluateClaims([tooLong], time).rejectedEvents, 1);
  assert.equal(checkIssue(makeIssue(4, marker()), [], [tooLong], time).result, "NOT_READY_OR_UNCERTAIN");
});
test("malformed / accessory metadata never elevates task readiness", () => {
  const issue = makeIssue(9, '<!-- teamforge-task-v1 {"priority":"p0","readiness":"invalid","area":"unity"} -->');
  assert.equal(planQueue([issue])[0].selection, "NOT_AUTO_SELECTABLE");
});
test("legacy resume entry points carry explicit archival warning", () => {
  for (const path of ["CURRENT_STATE.md", "NEXT_SESSION.md", "CHANGED_FILES.md", "PROJECT_CONTEXT.md", "TEST_EVIDENCE.md"]) {
    const text = readFileSync(new URL("../docs/work-state/" + path, import.meta.url), "utf8");
    assert.match(text.split("\n").slice(0, 7).join("\n"), /ARCHIVED HISTORICAL CHECKPOINT — NOT CURRENT TASK INSTRUCTIONS/u);
  }
});


test("hourly audit never upgrades missing claim comments to a free lease", () => {
  const issues = [makeIssue(10, marker()), makeIssue(11, marker("p2", "needs-field-test")), makeIssue(12)];
  const missing = summarizeAudit(issues, [], {}, time);
  assert.equal(missing.counts.openIssues, 3);
  assert.equal(missing.counts.uncertain, 1);
  assert.equal(missing.counts.noClaimObserved, 0);
  assert.equal(missing.issues.find(x => x.issue === 10).result, "CLAIM_CHECK_MISSING_FAIL_CLOSED");
  const checked = summarizeAudit(issues, [], { "10": [claim("claim")] }, time);
  assert.equal(checked.counts.activeOrConflicting, 1);
  assert.equal(checked.counts.claimChecksPerformed, 1);
  const idle = summarizeAudit(issues, [], { "10": [] }, time);
  assert.equal(idle.counts.noClaimObserved, 1);
  assert.match(auditMarkdown(idle), /does not claim an issue/);
  assert.doesNotMatch(auditMarkdown(idle), /LOCK_ACQUIRED/);
});
test("audit sanitizes Markdown injection and distinguishes fixtures", async () => {
  const issue = makeIssue(44, marker());
  issue.title = "Bad | heading\n<unsafe>";
  const report = summarizeAudit([issue], [], { "44": [] }, time);
  assert.doesNotMatch(auditMarkdown(report), /Bad \| heading/);
  assert.doesNotMatch(auditMarkdown(report), /<unsafe>/);
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "tf-queue-"));
  try {
    const filename = join(dir, "fixture.json");
    await writeFile(filename, JSON.stringify({ now: time, issues: [issue], pulls: [], comments: { "44": [] } }));
    const result = await runCli(["audit", "--fixture", filename]);
    assert.equal(result.source, "OFFLINE_FIXTURE");
    assert.equal(result.counts.noClaimObserved, 1);
    assert.equal(result.mode, "READ_ONLY_NO_WORK_DISPATCH");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("hourly agent audit stays on Linux self-hosted runner and minute-zero schedule", () => {
  const workflow = readFileSync(new URL("../.github/workflows/agent-workqueue-audit.yml", import.meta.url), "utf8");
  assert.match(workflow, /^    - cron: '0 \* \* \* \*'$/m);
  assert.match(workflow, /^    runs-on: \[self-hosted, Linux, shared-minipc\]$/m);
  assert.doesNotMatch(workflow, /runs-on: ubuntu-latest/);
  assert.match(workflow, /^  contents: read$/m);
  assert.match(workflow, /^  issues: read$/m);
  assert.match(workflow, /^  pull-requests: read$/m);
  assert.match(workflow, /npm run agent:queue -- audit/);
});
