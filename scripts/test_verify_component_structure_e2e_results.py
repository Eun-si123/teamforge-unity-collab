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

    def test_durable_gate_requires_distinct_epochs_exact_source_and_both_participants(self):
        self.write("result.json", {**self.editor, **dict.fromkeys(MODULE.PRIMITIVE_CHECKS, True),
                                  "durableRestartVerified": True})
        self.write("fixture-result.json", {**self.peer, "primitiveVerified": True})
        restart = {"sourceSha": "a" * 40, "durableRestartVerified": True, "serverRevision": 23,
                   "oldEpoch": "8ea94499-1fb3-4525-840f-f32a0e27d3ba",
                   "newEpoch": "c59546e2-c443-4323-ae43-70f4c7071dd3",
                   "durableSessionId": "c36552f6-c078-4da0-8c51-09a45f56817a",
                   "sphereComponentId": "tf:c:" + "a" * 32, "cubeObjectId": "tf:" + "b" * 32}
        resubmit = {"sourceSha": "a" * 40, "durableResubmitVerified": True, "serverRevision": 24,
                    "authorityEpoch": restart["newEpoch"], "componentId": restart["sphereComponentId"], "value": 2.5}
        self.write("durable-restart-result.json", restart)
        self.write("durable-resubmit-result.json", resubmit)
        with self.assertRaisesRegex(ValueError, "Durable Session"):
            MODULE.verify(self.xml, self.root, "a" * 40, require_durable=True)
        self.write("fixture-result.json", {**self.peer, "primitiveVerified": True, "durableRestartVerified": True})
        for name, value in [("sourceSha", "b" * 40), ("newEpoch", restart["oldEpoch"]),
                            ("durableSessionId", "malformed"), ("serverRevision", True),
                            ("durableRestartVerified", False)]:
            self.write("durable-restart-result.json", {**restart, name: value})
            with self.assertRaisesRegex(ValueError, "Durable Session"):
                MODULE.verify(self.xml, self.root, "a" * 40, require_durable=True)
        self.write("durable-restart-result.json", restart)
        for name, value in [("authorityEpoch", restart["oldEpoch"]), ("componentId", "tf:c:" + "b" * 32),
                            ("value", 1.25), ("serverRevision", restart["serverRevision"])]:
            self.write("durable-resubmit-result.json", {**resubmit, name: value})
            with self.assertRaisesRegex(ValueError, "Durable Session"):
                MODULE.verify(self.xml, self.root, "a" * 40, require_durable=True)
        self.write("durable-resubmit-result.json", resubmit)
        MODULE.verify(self.xml, self.root, "a" * 40, require_durable=True)
        self.write("result.json", {**self.editor, **dict.fromkeys(MODULE.PRIMITIVE_CHECKS, True),
                                  "durableRestartVerified": True, "durableTransformVerified": True})
        self.write("fixture-result.json", {**self.peer, "primitiveVerified": True,
                                        "durableRestartVerified": True, "durableTransformVerified": True})
        transform = {"sourceSha": "a" * 40, "durableTransformVerified": True, "serverRevision": 25,
                     "authorityEpoch": restart["newEpoch"], "durableSessionId": restart["durableSessionId"],
                     "objectId": restart["cubeObjectId"], "localPosition": {"x": 6, "y": 1, "z": -2},
                     "localScale": {"x": 1.5, "y": 2, "z": 0.75}}
        for name, value in [("authorityEpoch", restart["oldEpoch"]), ("objectId", "tf:" + "c" * 32),
                            ("serverRevision", resubmit["serverRevision"]), ("localPosition", {"x": 4, "y": 1, "z": -2})]:
            self.write("durable-transform-result.json", {**transform, name: value})
            with self.assertRaisesRegex(ValueError, "Reviewed Transform"):
                MODULE.verify(self.xml, self.root, "a" * 40, require_durable_transform=True)
        self.write("durable-transform-result.json", transform)
        MODULE.verify(self.xml, self.root, "a" * 40, require_durable_transform=True)
        self.write("result.json", {**self.editor, **dict.fromkeys(MODULE.PRIMITIVE_CHECKS, True),
                                  "durableRestartVerified": True, "durableTransformVerified": True,
                                  "durableHierarchyVerified": True})
        self.write("fixture-result.json", {**self.peer, "primitiveVerified": True, "durableRestartVerified": True,
                                        "durableTransformVerified": True, "durableHierarchyVerified": True})
        before = {"sourceSha": "a" * 40, "serverRevision": 25, "hierarchyRevision": 1,
                  "objectId": "GlobalObjectId_V1-2-" + "a" * 32 + "-10-0", "authorityEpoch": restart["newEpoch"],
                  "durableSessionId": restart["durableSessionId"], "name": "M2 authoritative owner before Collider join"}
        renamed = {**before, "serverRevision": 26, "operationId": "rename-op", "durableHierarchyVerified": True,
                   "name": "M4 reviewed local Hierarchy name"}
        self.write("durable-hierarchy-ready.json", before)
        for name, value in [("authorityEpoch", restart["oldEpoch"]), ("objectId", restart["cubeObjectId"]),
                            ("serverRevision", before["serverRevision"]), ("name", before["name"]), ("operationId", "")]:
            self.write("durable-hierarchy-result.json", {**renamed, name: value})
            with self.assertRaisesRegex(ValueError, "Reviewed Hierarchy"):
                MODULE.verify(self.xml, self.root, "a" * 40, require_durable_hierarchy=True)
        self.write("durable-hierarchy-result.json", renamed)
        MODULE.verify(self.xml, self.root, "a" * 40, require_durable_hierarchy=True)

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
