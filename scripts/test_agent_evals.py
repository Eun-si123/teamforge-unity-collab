"""Regression tests for the evidence runner; no network, model or production resources."""
import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from agent_evals import ROOT, MANIFEST, validate, evidence_status, run_case
import json

class EvalRunnerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.doc = json.loads(MANIFEST.read_text(encoding="utf-8"))

    def test_checked_in_cases_validate(self):
        self.assertGreaterEqual(len(validate(self.doc)), 2)

    def test_reject_duplicate_case(self):
        doc = copy.deepcopy(self.doc)
        doc["cases"].append(copy.deepcopy(doc["cases"][0]))
        with self.assertRaisesRegex(ValueError, "duplicate"):
            validate(doc)

    def test_reject_path_escape(self):
        doc = copy.deepcopy(self.doc)
        manual = next((s for c in doc["cases"] for s in c["steps"] if s["kind"] != "command"), None)
        self.assertIsNotNone(manual)
        manual["reference"] = "../../etc/passwd"
        with self.assertRaises(ValueError):
            validate(doc)

    def test_no_false_pass_without_field_evidence(self):
        self.assertEqual(evidence_status([{"status": "passed"}, {"status": "incomplete"}]), "incomplete")
        self.assertEqual(evidence_status([]), "incomplete")
        self.assertEqual(evidence_status([{"status": "failed"}, {"status": "incomplete"}]), "failed")

    def test_runner_does_not_convert_manual_step_into_success(self):
        case = {"id": "selftest", "steps": [
            {"id": "ok", "kind": "command", "argv": [sys.executable, "-c", "pass"], "cwd": "."},
            {"id": "field", "kind": "manual", "reference": "README.md", "reason": "Physical validation required"}]}
        result = run_case(case, "selftest", 5)
        self.assertEqual(result["evidenceStatus"], "incomplete")
        self.assertEqual(result["steps"][0]["status"], "passed")

    def test_negative_command_is_failed(self):
        case = {"id": "selftest", "steps": [{"id": "bad", "kind": "command",
            "argv": [sys.executable, "-c", "raise SystemExit(4)"], "cwd": "."}]}
        result = run_case(case, "selftest", 5)
        self.assertEqual(result["evidenceStatus"], "failed")
        self.assertEqual(result["steps"][0]["exitCode"], 4)

if __name__ == "__main__":
    unittest.main()
