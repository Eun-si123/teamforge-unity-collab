"""Model PASS and stale artifacts cannot stand in for a real lifecycle Editor run."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location(
    "structure_evidence", Path(__file__).with_name("verify-component-structure-e2e-results.py"))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ComponentStructureEvidenceTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="teamforge-structure-evidence-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.xml = self.root / "results.xml"
        self.case = f'<test-case fullname="{MODULE.TEST}" result="Passed" />'
        self.xml.write_text(f'<test-run total="1" failed="0" inconclusive="0">{self.case}</test-run>')
        self.editor = {"passed": True, "editorCount": 1, "nodePeerCount": 1,
                       "unityVersion": "6000.3.21f1", "sourceSha": "a" * 40,
                       **{check: True for check in MODULE.CHECKS}}
        self.peer = {"passed": True, "remoteCommitted": True, "sourceSha": "a" * 40,
                     "evidenceClass": "one-unity-editor-plus-node-peer", "unityVersion": "6000.3.21f1"}
        self.write("result.json", self.editor)
        self.write("fixture-result.json", self.peer)
        self.write("peer-result.json", {"remoteCommitted": True})

    def write(self, name, value):
        (self.root / name).write_text(json.dumps(value))

    def verify(self):
        MODULE.verify(self.xml, self.root, "a" * 40)

    def test_real_matching_case_and_all_evidence_pass(self):
        self.verify()

    def test_primitive_gate_requires_each_editor_step_and_node_confirmation(self):
        with self.assertRaisesRegex(ValueError, "Shared primitive"):
            MODULE.verify(self.xml, self.root, "a" * 40, require_primitive=True)
        editor = {**self.editor, **dict.fromkeys(MODULE.PRIMITIVE_CHECKS, True)}
        self.write("result.json", editor)
        with self.assertRaisesRegex(ValueError, "Shared primitive"):
            MODULE.verify(self.xml, self.root, "a" * 40, require_primitive=True)
        self.write("fixture-result.json", {**self.peer, "primitiveVerified": True})
        for name in MODULE.PRIMITIVE_CHECKS:
            self.write("result.json", {**editor, name: False})
            with self.assertRaisesRegex(ValueError, "Shared primitive"):
                MODULE.verify(self.xml, self.root, "a" * 40, require_primitive=True)
        self.write("result.json", editor)
        MODULE.verify(self.xml, self.root, "a" * 40, require_primitive=True)

    def test_missing_skipped_duplicate_or_different_test_cannot_pass(self):
        for cases, total in [("", "0"), (self.case.replace("Passed", "Skipped"), "1"),
                             (self.case + self.case, "2"),
                             (self.case.replace("ColliderStructureE2ETests", "ModelTests"), "1")]:
            self.xml.write_text(f'<test-run total="{total}" failed="0" inconclusive="0">{cases}</test-run>')
            with self.assertRaises(ValueError):
                self.verify()

    def test_failing_or_inconsistent_suite_and_xml_entities_are_refused(self):
        for summary in ['total="1" failed="1" inconclusive="0"',
                        'total="2" failed="0" inconclusive="0"',
                        'total="1" failed="0" inconclusive="1"']:
            self.xml.write_text(f'<test-run {summary}>{self.case}</test-run>')
            with self.assertRaises(ValueError):
                self.verify()
        self.xml.write_text('<!DOCTYPE test-run [<!ENTITY x "unsafe">]><test-run/>')
        with self.assertRaises(ValueError):
            self.verify()

    def test_every_lifecycle_phase_and_both_source_pins_are_required(self):
        for name in [*MODULE.CHECKS, "passed", "sourceSha"]:
            self.write("result.json", {**self.editor, name: "b" * 40 if name == "sourceSha" else False})
            with self.assertRaises(ValueError):
                self.verify()
        self.write("result.json", self.editor)
        for name, value in [("passed", False), ("sourceSha", "b" * 40),
                            ("evidenceClass", "node-only"), ("unityVersion", "different"),
                            ("remoteCommitted", False)]:
            self.write("fixture-result.json", {**self.peer, name: value})
            with self.assertRaises(ValueError):
                self.verify()

    def test_false_editor_counts_duplicate_json_and_missing_remote_are_refused(self):
        for name in ["editorCount", "nodePeerCount"]:
            self.write("result.json", {**self.editor, name: True})
            with self.assertRaises(ValueError):
                self.verify()
        self.write("result.json", self.editor)
        file = self.root / "result.json"
        file.write_text(file.read_text()[:-1] + ',"passed":true}')
        with self.assertRaises(ValueError):
            self.verify()
        self.write("result.json", self.editor)
        (self.root / "peer-result.json").unlink()
        with self.assertRaises(ValueError):
            self.verify()


if __name__ == "__main__":
    unittest.main()
