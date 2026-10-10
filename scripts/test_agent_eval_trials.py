"""Self-contained negative/positive tests for reviewed trial metadata; no agent invoked."""
import argparse
import copy
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from agent_evals import MANIFEST, validate
from agent_eval_trials import assess, canonical, check_run, compare, digest, make_template


class TrialEvidenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cases = validate(json.loads(MANIFEST.read_text(encoding="utf-8")))
        cls.case = next(iter(cls.cases.values()))

    def synthetic_run(self):
        steps = []
        for spec in self.case["steps"]:
            row = {"id": spec["id"], "kind": spec["kind"]}
            if spec["kind"] == "command":
                row.update(status="passed", exitCode=0, argv=spec["argv"])
            else:
                row.update(status="incomplete", reference=spec["reference"])
            steps.append(row)
        return {"schemaVersion": 1, "caseId": self.case["id"], "sourceCommit": "a" * 40,
                "steps": steps,
                "evidenceStatus": "incomplete" if any(s["kind"] != "command" for s in steps) else "passed"}

    def make_review(self, report=None):
        report = report or self.synthetic_run()
        raw = (json.dumps(report) + "\n").encode()
        args = argparse.Namespace(starting_commit="b" * 40, trial_id="trial-a",
                                  variant="baseline", environment="test-env",
                                  agent="worker", reviewer="independent")
        review = make_template(report, raw, self.case, args)
        return report, raw, review

    def complete_review(self, review):
        review = copy.deepcopy(review)
        for key in ("acceptance", "regressions", "externalSteps"):
            for item in review[key]:
                item["status"], item["evidence"] = "passed", "validated:test-fixture"
        review["agentWallSeconds"] = 33.2
        review["humanMinutes"] = 1.5
        return review

    def test_template_remains_incomplete(self):
        report, raw, review = self.make_review()
        self.assertEqual(assess(report, raw, review, self.case)["reviewedOutcome"], "incomplete")

    def test_positive_independent_attestation(self):
        report, raw, review = self.make_review()
        graded = assess(report, raw, self.complete_review(review), self.case)
        self.assertEqual(graded["reviewedOutcome"], "review-attested-pass")
        self.assertEqual(graded["automatedStatus"], report["evidenceStatus"])

    def test_agent_cannot_upgrade_manual_runner_evidence(self):
        report = self.synthetic_run()
        manual = next(row for row in report["steps"] if row["kind"] != "command")
        manual["status"] = "passed"
        with self.assertRaisesRegex(ValueError, "upgraded"):
            check_run(report, self.case)

    def test_command_argv_mismatch_rejected(self):
        report = self.synthetic_run()
        command = next(row for row in report["steps"] if row["kind"] == "command")
        command["argv"] = ["true"]
        with self.assertRaisesRegex(ValueError, "unexpected argv"):
            check_run(report, self.case)

    def test_report_tampering_rejected(self):
        report, raw, review = self.make_review()
        review["runSha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "not bound"):
            assess(report, raw, review, self.case)

    def test_no_self_review(self):
        report, raw, review = self.make_review()
        review["reviewer"] = review["agent"]
        with self.assertRaisesRegex(ValueError, "self-review"):
            assess(report, raw, review, self.case)

    def test_no_false_pass_from_blank_review_evidence(self):
        report, raw, review = self.make_review()
        review = self.complete_review(review)
        review["acceptance"][0]["evidence"] = ""
        with self.assertRaisesRegex(ValueError, "needs evidence"):
            assess(report, raw, review, self.case)

    def test_negative_independent_review_fails(self):
        report, raw, review = self.make_review()
        review = self.complete_review(review)
        review["regressions"][0]["status"] = "failed"
        self.assertEqual(assess(report, raw, review, self.case)["reviewedOutcome"], "failed")

    def test_mismatched_starting_commit_rejected(self):
        report, raw, review = self.make_review()
        a = assess(report, raw, self.complete_review(review), self.case)
        b = dict(a, variant="candidate", trialId="trial-b", startingCommit="c" * 40)
        with self.assertRaisesRegex(ValueError, "unmatched startingCommit"):
            compare([a, b])

    def test_duplicate_trial_id_rejected(self):
        report, raw, review = self.make_review()
        a = assess(report, raw, self.complete_review(review), self.case)
        b = dict(a, variant="candidate")
        with self.assertRaisesRegex(ValueError, "duplicate trial"):
            compare([a, b])

    def test_comparison_is_descriptive_only(self):
        report, raw, review = self.make_review()
        a = assess(report, raw, self.complete_review(review), self.case)
        records = [dict(a, variant=variant, trialId=f"trial-{i}-{variant}")
                   for variant in ("baseline", "candidate") for i in range(3)]
        result = compare(records)
        self.assertEqual(result["evaluation"], "descriptive-only")
        self.assertEqual(result["variants"]["baseline"]["attempts"], 3)
        result = compare(records[:1] + records[3:4])
        self.assertEqual(result["evaluation"], "insufficient-matched-complete-trials")

    def test_negative_command_fails_even_with_positive_review(self):
        report, raw, review = self.make_review()
        command = next(row for row in report["steps"] if row["kind"] == "command")
        command["status"], command["exitCode"] = "failed", 9
        report["evidenceStatus"] = "failed"
        raw = (json.dumps(report) + "\n").encode()
        review["runSha256"] = digest(raw)
        self.assertEqual(assess(report, raw, self.complete_review(review), self.case)["reviewedOutcome"], "failed")


if __name__ == "__main__":
    unittest.main()
