"""Hermetic host-boundary tests; synthetic XML is not Unity execution evidence."""
import argparse
import copy
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

HELPER = Path(__file__).with_name("unity-clone-probe.py")
SPEC = importlib.util.spec_from_file_location("unity_clone_probe", HELPER)
probe = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(probe)


class CloneProbeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.workspace = Path(self.temp.name).resolve()
        self.source = self.workspace / "unity-project"
        self.package = self.workspace / "unity-package" / probe.PACKAGE
        self.write(self.source / "Packages/manifest.json", json.dumps({
            "dependencies": {probe.PACKAGE: "file:../../unity-package/" + probe.PACKAGE, "com.example.pinned": "1.2.3"},
            "testables": [probe.PACKAGE], "future": {"__type": 42, "unicode": "한글"}}))
        self.write(self.source / "Assets/keep.txt", "source asset")
        self.write(self.package / "package.json", json.dumps({"name": probe.PACKAGE, "version": "0.5.1"}))
        self.write(self.package / "Editor/nested.cs", "package source\n")
        self.write(self.package / "Editor/nested.cs.meta", "guid: synthetic-meta\n")
        self.args = argparse.Namespace(workspace=str(self.workspace), run_id="12345", run_attempt="2",
            source_sha="a" * 40, editor=probe.EDITOR, token=None, source_results=None, probe_results=None)
        self.outputs = probe.init(self.args)
        self.args.token = self.outputs["token"]
        self.args.source_results = self.outputs["sourceResultsPath"]
        self.args.probe_results = self.outputs["probeResultsPath"]
        self.root = self.workspace / "test-results/clone-editor" / self.args.token
        self.clone = self.root / "clones" / ("TF-B-" + "b" * 32)

    def tearDown(self):
        self.temp.cleanup()

    @staticmethod
    def write(path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value, encoding="utf-8")

    @staticmethod
    def json_write(path, value):
        CloneProbeTests.write(path, json.dumps(value))

    def xml(self, stage, fullname=None, **changes):
        fields = dict(result="Passed", total="1", passed="1", failed="0", skipped="0", inconclusive="0")
        fields.update(changes)
        attributes = " ".join(f'{key}="{value}"' for key, value in fields.items())
        fullname = fullname or (probe.EXPORT_TEST if stage == "source" else probe.PROBE_TEST)
        path = self.workspace / self.outputs[stage + "ResultsPath"] / "editmode-results.xml"
        self.write(path, f'<test-run {attributes}><test-suite><test-case fullname="{fullname}" result="Passed" /></test-suite></test-run>')
        return path

    def synthetic_export(self):
        # Simulate the first UPM creating its initial lock after host init.
        lock = {"dependencies": {probe.PACKAGE: {"version": "file:../../unity-package/" + probe.PACKAGE,
                 "source": "local"}, "com.example.pinned": {"version": "1.2.3", "source": "registry", "depth": 0}}}
        self.json_write(self.source / "Packages/packages-lock.json", lock)
        shutil.copytree(self.source, self.clone)
        shutil.copytree(self.package, self.clone / "Packages" / probe.PACKAGE)
        manifest = json.loads((self.source / "Packages/manifest.json").read_text())
        manifest["dependencies"][probe.PACKAGE] = "file:" + probe.PACKAGE
        self.json_write(self.clone / "Packages/manifest.json", manifest)
        shutil.copyfile(self.source / "Packages/packages-lock.json", self.root / "initial-lock.json")
        owner = probe.read_json(self.root / "owner.json")
        receipt = {key: owner[key] for key in ("schemaVersion", "token", "sourceSha", "editor")}
        receipt.update(clonePath=self.clone.relative_to(self.workspace).as_posix(), packageName=probe.PACKAGE,
            packageVersion="0.5.1", sourceManifestSha256=probe.digest(self.source / "Packages/manifest.json")[1],
            cloneManifestSha256=probe.digest(self.clone / "Packages/manifest.json")[1],
            packageFiles=probe.file_list(probe.inventory(self.package)), **probe.lock_state(self.source))
        self.json_write(self.root / "export.json", receipt)
        self.xml("source")
        return receipt

    def synthetic_proof(self, receipt):
        proof = {key: receipt[key] for key in ("schemaVersion", "token", "sourceSha", "editor", "clonePath", "packageName", "packageVersion")}
        proof["packageSource"] = "Embedded"
        self.json_write(self.root / "probe.json", proof)
        self.xml("probe")

    def test_valid_two_stage_contract_preserves_source_old_runs_and_evidence(self):
        old = self.root.parent / "old-run/keep.txt"
        self.write(old, "previous contents")
        receipt = self.synthetic_export()
        original = (self.source / "Packages/manifest.json").read_bytes()
        self.assertEqual(probe.verify_export(self.args), {"clonePath": receipt["clonePath"], "ready": "true"})
        self.synthetic_proof(receipt)
        # UPM can omit its own embedded record while retaining unrelated pins.
        lock = probe.read_json(self.clone / "Packages/packages-lock.json")
        lock["dependencies"].pop(probe.PACKAGE)
        self.json_write(self.clone / "Packages/packages-lock.json", lock)
        self.assertEqual(probe.verify_probe(self.args)["result"], "PASS")
        probe.cleanup(self.args)
        self.assertFalse(self.root.exists())
        self.assertEqual(old.read_text(), "previous contents")
        self.assertEqual((self.source / "Packages/manifest.json").read_bytes(), original)
        self.assertTrue((self.workspace / self.args.source_results / "editmode-results.xml").is_file())

    def test_run_attempt_sha_editor_and_owner_mismatches_are_refused(self):
        for field, value in (("run_attempt", "3"), ("source_sha", "b" * 40), ("editor", "6000.3.27f2"), ("token", "../escape")):
            with self.subTest(field=field):
                altered = copy.copy(self.args)
                setattr(altered, field, value)
                with self.assertRaises(probe.ProbeError):
                    probe.cleanup(altered)
                self.assertTrue(self.root.exists())

    def test_source_changes_before_export_are_refused(self):
        self.synthetic_export()
        self.write(self.package / "Editor/nested.cs", "changed source")
        with self.assertRaisesRegex(probe.ProbeError, "source_package_changed"):
            probe.verify_export(self.args)

    def test_observed_editor_sdk_initialization_preserves_all_original_manifest_fields(self):
        path = self.source / "Packages/manifest.json"
        initialized = probe.read_json(path)
        # Actual 6000.3.21f1 artifact: these additions plus sorted two-space
        # formatting reproduce the exported manifest's exact SHA-256.
        initialized["dependencies"].update({"com.unity.sdk.linux-arm64": "1.1.0",
            "com.unity.sdk.linux-x86_64": "1.1.0", "com.unity.toolchain.linux-x86_64-linux": "1.1.0"})
        self.write(path, json.dumps(initialized, sort_keys=True, indent=2) + "\n")
        self.synthetic_export()
        self.assertEqual(probe.verify_export(self.args)["ready"], "true")
        baseline = probe.read_json(self.root / "baseline.json")
        self.assertNotIn("sourceManifest", baseline, "Do not upload dependency values or registry credentials.")
        self.assertNotEqual(baseline["sourceManifestSha256"], probe.digest(path)[1])

    def test_editor_initialization_cannot_change_versions_other_dependencies_or_fields(self):
        path = self.source / "Packages/manifest.json"
        original = probe.read_json(path)
        variants = []
        changed = copy.deepcopy(original)
        changed["dependencies"]["com.unity.sdk.linux-arm64"] = "9.9.9"
        variants.append(changed)
        changed = copy.deepcopy(original)
        changed["dependencies"]["com.unity.sdk.unexpected"] = "1.1.0"
        variants.append(changed)
        changed = copy.deepcopy(original)
        del changed["dependencies"]["com.example.pinned"]
        variants.append(changed)
        changed = copy.deepcopy(original)
        changed["testables"] = []
        variants.append(changed)
        changed = copy.deepcopy(original)
        changed["future"]["__type"] = 99
        variants.append(changed)
        for manifest in variants:
            with self.subTest(manifest=manifest):
                self.json_write(path, manifest)
                self.synthetic_export()
                with self.assertRaisesRegex(probe.ProbeError, "source_manifest_changed"):
                    probe.verify_export(self.args)
                shutil.rmtree(self.clone)

    def test_clone_extra_modified_and_meta_missing_files_are_refused(self):
        self.synthetic_export()
        package = self.clone / "Packages" / probe.PACKAGE
        for relative, content in (("extra.txt", "extra"), ("Editor/nested.cs", "changed"), ("Editor/nested.cs.meta", None)):
            with self.subTest(relative=relative):
                path = package / relative
                before = path.read_bytes() if path.exists() else None
                if content is None:
                    path.unlink()
                else:
                    self.write(path, content)
                with self.assertRaisesRegex(probe.ProbeError, "clone_package_changed"):
                    probe.verify_export(self.args)
                if before is None:
                    path.unlink()
                else:
                    path.write_bytes(before)

    def test_library_bootstrap_and_manifest_tampering_are_refused(self):
        self.synthetic_export()
        for relative in ("Library/reused", "UserSettings/TeamForgeCloneBootstrap.json", "Packages/manifest.json"):
            with self.subTest(relative=relative):
                path = self.clone / relative
                before = path.read_bytes() if path.exists() else None
                self.write(path, "tampered")
                with self.assertRaises(probe.ProbeError):
                    probe.verify_export(self.args)
                if before is None:
                    shutil.rmtree(path.parent)
                else:
                    path.write_bytes(before)

    def test_source_lock_and_preopen_clone_lock_must_match(self):
        self.synthetic_export()
        self.write(self.clone / "Packages/packages-lock.json", "{}")
        with self.assertRaisesRegex(probe.ProbeError, "initial_clone_lock_changed"):
            probe.verify_export(self.args)

    def test_zero_skipped_failed_wrong_and_duplicate_source_xml_cannot_pass(self):
        self.synthetic_export()
        for changes in ({"total": "0", "passed": "0"}, {"passed": "0", "skipped": "1"},
                        {"result": "Failed", "passed": "0", "failed": "1"}, {"total": "2"}):
            with self.subTest(changes=changes):
                self.xml("source", **changes)
                with self.assertRaises(probe.ProbeError):
                    probe.verify_export(self.args)
        self.xml("source", fullname=probe.PROBE_TEST)
        with self.assertRaisesRegex(probe.ProbeError, "exact_test_not_passed"):
            probe.verify_export(self.args)
        path = self.xml("source")
        shutil.copyfile(path, path.with_name("old.xml"))
        with self.assertRaisesRegex(probe.ProbeError, "fresh_xml_required"):
            probe.verify_export(self.args)

    def test_result_path_from_another_run_is_refused(self):
        self.synthetic_export()
        self.args.source_results = "unity-test-results"
        with self.assertRaisesRegex(probe.ProbeError, "results_path_mismatch"):
            probe.verify_export(self.args)

    def test_source_allows_real_unity_ignored_aggregate_only_with_exporter_passed(self):
        self.synthetic_export()
        path = self.xml("source")
        root = (f'<test-run result="Skipped:Ignored" total="2" passed="1" failed="0" skipped="1" inconclusive="0">'
                f'<test-suite><test-case fullname="{probe.EXPORT_TEST}" result="Passed" />'
                '<test-case fullname="OtherFlow" result="Skipped" label="Ignored" /></test-suite></test-run>')
        self.write(path, root)
        self.assertEqual(probe.verify_export(self.args)["ready"], "true")
        self.write(path, root.replace(f'fullname="{probe.EXPORT_TEST}" result="Passed"',
                                     f'fullname="{probe.EXPORT_TEST}" result="Skipped"'))
        with self.assertRaisesRegex(probe.ProbeError, "exact_test_not_passed"):
            probe.validate_xml(self.workspace, self.args.token, self.args.source_results, "source", probe.EXPORT_TEST)
        self.write(path, root.replace('total="2" passed="1"', 'total="3" passed="2"'))
        with self.assertRaisesRegex(probe.ProbeError, "unity_case_counts_mismatch"):
            probe.validate_xml(self.workspace, self.args.token, self.args.source_results, "source", probe.EXPORT_TEST)
        probe_xml = self.xml("probe")
        self.write(probe_xml, root.replace(probe.EXPORT_TEST, probe.PROBE_TEST))
        with self.assertRaisesRegex(probe.ProbeError, "unity_result_not_passed"):
            probe.validate_xml(self.workspace, self.args.token, self.args.probe_results, "probe", probe.PROBE_TEST)

    def test_probe_requires_host_verified_export_exact_proof_and_one_test(self):
        receipt = self.synthetic_export()
        self.synthetic_proof(receipt)
        with self.assertRaises(OSError):
            probe.verify_probe(self.args)
        probe.verify_export(self.args)
        self.xml("probe", total="2", passed="1", skipped="1")
        with self.assertRaisesRegex(probe.ProbeError, "probe_must_execute_once"):
            probe.verify_probe(self.args)
        self.xml("probe")
        proof = probe.read_json(self.root / "probe.json")
        proof["packageSource"] = "Local"
        self.json_write(self.root / "probe.json", proof)
        with self.assertRaisesRegex(probe.ProbeError, "probe_identity_mismatch"):
            probe.verify_probe(self.args)

    def test_unrelated_lock_changes_after_upm_are_refused(self):
        receipt = self.synthetic_export()
        probe.verify_export(self.args)
        self.synthetic_proof(receipt)
        lock = probe.read_json(self.clone / "Packages/packages-lock.json")
        lock["dependencies"]["com.example.pinned"]["version"] = "9.9.9"
        self.json_write(self.clone / "Packages/packages-lock.json", lock)
        with self.assertRaisesRegex(probe.ProbeError, "unrelated_lock_changed"):
            probe.verify_probe(self.args)

    def test_receipt_traversal_duplicate_and_absolute_paths_are_refused(self):
        receipt = self.synthetic_export()
        for path in ("../outside", "/tmp/outside", receipt["clonePath"] + "/../other"):
            with self.subTest(path=path):
                altered = dict(receipt, clonePath=path)
                self.json_write(self.root / "export.json", altered)
                with self.assertRaisesRegex(probe.ProbeError, "invalid_clone_path"):
                    probe.verify_export(self.args)
        self.write(self.root / "export.json", '{"token":"one","token":"two"}')
        with self.assertRaisesRegex(probe.ProbeError, "duplicate_json_key"):
            probe.verify_export(self.args)

    @unittest.skipUnless(hasattr(os, "symlink"), "symlink unavailable")
    def test_redirected_clone_source_xml_and_cleanup_never_follow_links(self):
        self.synthetic_export()
        keep = self.workspace / "external/keep.txt"
        self.write(keep, "preserve me")
        link = self.clone / "external"
        link.symlink_to(keep.parent, target_is_directory=True)
        with self.assertRaisesRegex(probe.ProbeError, "cleanup_not_direct"):
            probe.cleanup(self.args)
        self.assertEqual(keep.read_text(), "preserve me")
        link.unlink()
        xml = self.workspace / self.args.source_results / "editmode-results.xml"
        xml.unlink()
        xml.symlink_to(keep)
        with self.assertRaises(OSError):
            probe.verify_export(self.args)

    @unittest.skipUnless(hasattr(os, "mkfifo"), "POSIX FIFO unavailable")
    def test_static_fifo_is_refused_under_a_real_process_deadline(self):
        self.synthetic_export()
        fifo = self.clone / "Packages" / probe.PACKAGE / "blocked.fifo"
        os.mkfifo(fifo)
        command = [sys.executable, str(HELPER), "verify-export", "--workspace", str(self.workspace),
            "--run-id", self.args.run_id, "--run-attempt", self.args.run_attempt, "--source-sha", self.args.source_sha,
            "--editor", self.args.editor, "--token", self.args.token, "--source-results", self.args.source_results]
        result = subprocess.run(command, capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 1)
        self.assertNotIn(str(self.workspace), result.stderr)
        self.assertTrue(fifo.exists())


class HostedRunnerDiskTests(unittest.TestCase):
    def run_preparation(self, overrides=None, available=32 * 1024 * 1024):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            log = root / "commands.jsonl"
            mock = '''#!/usr/bin/env python3
import json, os, pathlib, sys
name = pathlib.Path(sys.argv[0]).name
with open(os.environ["TF_DISK_TEST_LOG"], "a") as stream:
    stream.write(json.dumps([name, *sys.argv[1:]]) + "\\n")
if name == "docker":
    print("/var/lib/docker")
elif name == "df":
    print("Filesystem 1024-blocks Used Available Capacity Mounted")
    print("testfs 999999999 1 " + os.environ["TF_DISK_TEST_AVAILABLE"] + " 1% /")
'''
            for name in ("docker", "df", "sudo", "rm"):
                path = root / name
                path.write_text(mock)
                path.chmod(0o755)
            env = dict(os.environ, GITHUB_ACTIONS="true", RUNNER_ENVIRONMENT="github-hosted", RUNNER_OS="Linux",
                       PATH=str(root) + os.pathsep + os.environ.get("PATH", ""),
                       TF_DISK_TEST_LOG=str(log), TF_DISK_TEST_AVAILABLE=str(available))
            env.update(overrides or {})
            result = subprocess.run(["bash", str(HELPER.with_name("prepare-unity-runner.sh"))],
                                    env=env, text=True, capture_output=True, timeout=5)
            calls = [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []
            return result, calls

    def test_local_self_hosted_and_non_linux_never_invoke_cleanup(self):
        for env in ({"GITHUB_ACTIONS": "false"}, {"RUNNER_ENVIRONMENT": "self-hosted"}, {"RUNNER_OS": "Windows"}):
            with self.subTest(env=env):
                result, calls = self.run_preparation(env)
                self.assertEqual(result.returncode, 2)
                self.assertEqual(calls, [], "No host command, including sudo, may run before the environment guard.")

    def test_hosted_cleanup_removes_only_fixed_unused_sdks_and_checks_docker_storage(self):
        result, calls = self.run_preparation()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([call for call in calls if call[0] == "sudo"],
                         [["sudo", "rm", "-rf", "--", "/usr/share/dotnet", "/usr/local/lib/android", "/opt/ghc"]])
        self.assertFalse(any(call[0] == "rm" for call in calls))
        self.assertIn(["df", "-Pk", "/var/lib/docker"], calls)

    def test_insufficient_or_unreadable_capacity_is_not_editor_execution(self):
        for available in (1024, "invalid"):
            with self.subTest(available=available):
                result, _ = self.run_preparation(available=available)
                self.assertEqual(result.returncode, 2)
                self.assertIn("NOT RUN", result.stderr)


if __name__ == "__main__":
    unittest.main()
