import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { checkIssue, evaluateClaims, linkedPullRequests, planQueue } from "./agent-workqueue.mjs";

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
