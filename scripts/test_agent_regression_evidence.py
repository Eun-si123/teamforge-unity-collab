"""Evidence runner negative controls: failures and missing tools cannot become success."""
import json
from pathlib import Path
from subprocess import CompletedProcess
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
from agent_feature_map import MAP, validate
from agent_regression_evidence import build_receipt, run_one, select_report, selected_tests


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

    def test_dirty_tree_cannot_claim_commit_bound_evidence(self):
        receipt = build_receipt(self.features, ["server/src/session-authority.mjs"],
                                runner=lambda x: {"testFile": x, "status": "passed"},
                                state=lambda: ("c"*40, False))
        self.assertEqual(receipt["status"], "incomplete")
        self.assertFalse(receipt["trackedClean"])


if __name__ == "__main__":
    unittest.main()
