"""A green model suite must not substitute for a missing real Unity roundtrip."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("component_evidence", Path(__file__).with_name("verify-component-e2e-results.py"))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ComponentEvidenceTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix="teamforge-component-evidence-")
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.xml = self.root / "results.xml"
        self.case = f'<test-case fullname="{MODULE.TEST}" result="Passed" />'
        self.xml.write_text(f'<test-run total="1" failed="0" inconclusive="0">{self.case}</test-run>')
        self.editor = {"passed": True, "editorCount": 1, "nodePeerCount": 1, "unityVersion": "6000.3.21f1",
                       "continuousEdit": True, "conditionalUndoRedo": True, "remoteApply": True,
                       "nativeUndoConflict": True, "pendingAckLossRecovery": True, "reconnectRecovery": True}
        self.peer = {"passed": True, "remoteCommitted": True, "sourceSha": "a" * 40,
                     "evidenceClass": "one-unity-editor-plus-node-peer", "unityVersion": "6000.3.21f1"}
        self.write("result.json", self.editor)
        self.write("fixture-result.json", self.peer)
        self.write("peer-result.json", {"remoteCommitted": True})

    def write(self, name, value):
        (self.root / name).write_text(json.dumps(value))

    def verify(self):
        MODULE.verify(self.xml, self.root, "a" * 40)

    def test_matching_editor_and_peer_pass(self):
        self.verify()

    def test_skipped_missing_duplicate_and_unsafe_nunit_fail(self):
        for xml in ['<test-run total="0" failed="0" inconclusive="0" />',
                    f'<test-run total="1" failed="0" inconclusive="0">{self.case.replace("Passed", "Skipped")}</test-run>',
                    f'<test-run total="2" failed="0" inconclusive="0">{self.case}{self.case}</test-run>',
                    "<!DOCTYPE test-run><test-run />"]:
            self.xml.write_text(xml)
            with self.assertRaises(ValueError):
                self.verify()

    def test_missing_or_partial_peer_evidence_and_wrong_source_fail(self):
        for field, value in [("passed", False), ("sourceSha", "b" * 40), ("unityVersion", "6000.6.8f1")]:
            self.write("fixture-result.json", {**self.peer, field: value})
            with self.assertRaises(ValueError):
                self.verify()
        self.write("fixture-result.json", self.peer)
        self.write("result.json", {**self.editor, "reconnectRecovery": False})
        with self.assertRaises(ValueError):
            self.verify()
        self.write("result.json", self.editor)
        (self.root / "peer-result.json").unlink()
        with self.assertRaises(ValueError):
            self.verify()

    def test_failed_or_inconsistent_run_summary_cannot_hide_a_passing_target(self):
        for summary in ['total="1" failed="1" inconclusive="0"',
                        'total="2" failed="0" inconclusive="0"',
                        'total="1" failed="0" inconclusive="1"', '']:
            self.xml.write_text(f'<test-run {summary}>{self.case}</test-run>')
            with self.assertRaises(ValueError):
                self.verify()


if __name__ == "__main__":
    unittest.main()
