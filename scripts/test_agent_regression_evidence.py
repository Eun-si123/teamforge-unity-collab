"""Evidence runner negative controls: failures and missing tools cannot become success."""
import json
from pathlib import Path
from subprocess import CompletedProcess
import sys
import subprocess
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
from agent_feature_map import MAP, validate
from agent_regression_evidence import build_receipt, checkout_matches, resolve_commit, run_one, select_report, selected_tests


class AgentRegressionEvidenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.features = validate(json.loads(MAP.read_text()))

    def test_source_change_selects_exact_known_tests(self):
        paths = selected_tests(self.features, ["server/src/session-authority.mjs"])
        self.assertIn("server/test/session-authority.test.mjs", paths)
        self.assertNotIn("project-peer/test/direct-transfer.test.mjs", paths)

    def test_changed_test_alone_does_not_reclassify_source(self):
        row = select_report(self.features, ["server/test/session-authority.test.mjs"])
        self.assertEqual(row["regressions"], [])
        self.assertEqual(row["execution"], "not-run")

    def test_missing_or_unmapped_changes_cannot_fabricate_pass(self):
        receipt = build_receipt(self.features, ["server/src/unknown.mjs"],
                                runner=lambda x: self.fail("should not run"),
                                state=lambda: ("a"*40, True))
        self.assertEqual(receipt["status"], "not-applicable")
        self.assertEqual(receipt["fieldEvidence"], "not-run")
        self.assertEqual(receipt["tests"], [])

    def test_real_exit_code_is_required(self):
        def fake_runner(argv, **kwargs):
            return CompletedProcess(argv, 19, stdout=b"FAIL test fixture", stderr=b"failed")
        row = run_one("server/test/session-authority.test.mjs", executor=fake_runner)
        self.assertEqual(row["status"], "failed")
        self.assertEqual(row["exitCode"], 19)
        self.assertNotEqual(row["stdoutSha256"], "")
        self.assertNotIn("FAIL test fixture", str(row))
        self.assertNotIn("failed", row.get("stderrTail", ""))

    def test_missing_executable_does_not_claim_pass(self):
        def missing(argv, **kwargs):
            raise FileNotFoundError("node")
        row = run_one("server/test/session-authority.test.mjs", executor=missing)
        self.assertEqual(row["status"], "failed")
        self.assertEqual(row["error"], "FileNotFoundError")

    def test_timeout_does_not_claim_pass(self):
        from subprocess import TimeoutExpired
        def timeout(argv, **kwargs):
            raise TimeoutExpired(argv, 1)
        row = run_one("server/test/session-authority.test.mjs", executor=timeout)
        self.assertEqual(row["status"], "failed")
        self.assertEqual(row["error"], "timeout")

    def test_success_requires_all_selected_tests_passing(self):
        receipt = build_receipt(self.features, ["server/src/session-authority.mjs"],
                                runner=lambda x: {"testFile": x, "status": "passed"},
                                state=lambda: ("a"*40, True))
        self.assertEqual(receipt["status"], "passed")
        self.assertEqual(receipt["sourceCommit"], "a"*40)
        self.assertEqual(receipt["fieldEvidence"], "not-run")

    def test_a_single_failed_test_blocks_success(self):
        receipt = build_receipt(self.features, ["server/src/session-authority.mjs"],
                                runner=lambda x: {"testFile": x, "status": "failed"},
                                state=lambda: ("b"*40, True))
        self.assertEqual(receipt["status"], "failed")

    def test_checkout_changes_during_execution_invalidate_receipt(self):
        states = iter([("a"*40, True), ("b"*40, True)])
        receipt = build_receipt(self.features, ["server/src/session-authority.mjs"],
                                runner=lambda x: {"testFile": x, "status": "passed"},
                                state=lambda: next(states))
        self.assertEqual(receipt["status"], "incomplete")
        self.assertEqual(receipt["sourceCommitAfter"], "b"*40)

    def test_tracked_change_during_execution_invalidates_receipt(self):
        states = iter([("a"*40, True), ("a"*40, False)])
        receipt = build_receipt(self.features, ["server/src/session-authority.mjs"],
                                runner=lambda x: {"testFile": x, "status": "passed"},
                                state=lambda: next(states))
        self.assertEqual(receipt["status"], "incomplete")
        self.assertFalse(receipt["trackedClean"])

    def test_unrelated_checkout_never_runs_selected_tests(self):
        receipt = build_receipt(self.features, ["server/src/session-authority.mjs"],
                                runner=lambda x: self.fail("wrong checkout must not execute"),
                                state=lambda: ("c"*40, True),
                                source_matches=lambda commit: False)
        self.assertEqual(receipt["status"], "incomplete")
        self.assertFalse(receipt["checkoutMatchesSelection"])
        self.assertEqual(receipt["tests"], [])

    def test_real_git_checkout_accepts_head_or_exact_pr_merge(self):
        with tempfile.TemporaryDirectory() as tmp:
            def git(*args):
                return subprocess.check_output(
                    ["git", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
                     "-c", "commit.gpgsign=false", *args], cwd=tmp,
                    text=True, stderr=subprocess.DEVNULL).strip()
            git("init", "-b", "main")
            git("commit", "--allow-empty", "-m", "base")
            base = resolve_commit("HEAD", tmp)
            git("switch", "-c", "feature")
            git("commit", "--allow-empty", "-m", "feature")
            head = resolve_commit("HEAD", tmp)
            git("switch", "main")
            git("commit", "--allow-empty", "-m", "base advances")
            updated_base = resolve_commit("HEAD", tmp)
            git("merge", "--no-ff", "feature", "-m", "PR merge")
            merge = resolve_commit("HEAD", tmp)
            self.assertTrue(checkout_matches(updated_base, head, head, tmp))
            self.assertTrue(checkout_matches(updated_base, head, merge, tmp))
            self.assertFalse(checkout_matches(base, head, merge, tmp))
            self.assertFalse(checkout_matches(updated_base, head, updated_base, tmp))
            self.assertFalse(checkout_matches(head, updated_base, merge, tmp))

    def test_dirty_tree_cannot_claim_commit_bound_evidence(self):
        receipt = build_receipt(self.features, ["server/src/session-authority.mjs"],
                                runner=lambda x: {"testFile": x, "status": "passed"},
                                state=lambda: ("c"*40, False))
        self.assertEqual(receipt["status"], "incomplete")
        self.assertFalse(receipt["trackedClean"])


if __name__ == "__main__":
    unittest.main()
