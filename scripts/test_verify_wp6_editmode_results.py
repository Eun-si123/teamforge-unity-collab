"""Synthetic NUnit fixtures: a GameCI green job is not enough by itself."""
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path


SCRIPT = Path(__file__).with_name("verify-wp6-editmode-results.py")
NAME = "TeamForgeWp6PreviewSourceGateTests"
ROOT = "EunSung.TeamForge.Tests."
METHODS = ["SourceMatches", "DirtySceneRejected"]


class Wp6NUnitEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="teamforge-wp6-xml-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.src = self.root / "Tests"
        self.src.mkdir()
        self.xml = self.root / "current-run.xml"
        self.set_source()

    def set_source(self, methods=METHODS, suffix=""):
        tests = "\n".join(f"    [Test]\n    public void {name}() {{ }}" for name in methods)
        (self.src / (NAME + ".cs")).write_text(
            "namespace EunSung.TeamForge.Tests {\n"
            f" public sealed class {NAME} {{\n{tests}\n }}\n}}\n{suffix}",
            encoding="utf-8",
        )

    def set_xml(self, methods=METHODS, results=None, **counts):
        results = results or {m: "Passed" for m in methods}
        root = ET.Element("test-run", {
            "total": str(counts.get("total", len(methods))),
            "passed": str(counts.get("passed", sum(x == "Passed" for x in results.values()))),
            "failed": str(counts.get("failed", sum(x == "Failed" for x in results.values()))),
            "skipped": str(counts.get("skipped", sum(x == "Skipped" for x in results.values()))),
            "inconclusive": str(counts.get("inconclusive", 0)),
            # Actual Unity main run can have result="Skipped:Ignored"
            # even though all runnable tests pass.
            "result": "Skipped:Ignored",
        })
        assembly = ET.SubElement(root, "test-suite", {"name": "EunSung.TeamForge.Editor.Tests.dll"})
        for method in methods:
            ET.SubElement(assembly, "test-case", {
                "name": method, "classname": ROOT + NAME,
                "fullname": ROOT + NAME + "." + method,
                "methodname": method, "result": results[method],
            })
        ET.ElementTree(root).write(self.xml, encoding="utf-8", xml_declaration=True)

    def run_check(self, path=None, directory=None):
        return subprocess.run([
            sys.executable, str(SCRIPT), "--results", str(path or self.xml),
            "--tests-dir", str(directory or self.src),
        ], text=True, capture_output=True, timeout=5)

    def test_real_nunit_names_all_passed(self):
        self.set_xml()
        result = self.run_check()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("2 WP6 EditMode test methods", result.stdout)

    def test_no_wp6_test_classes_on_older_main_is_skipped(self):
        empty = self.root / "legacy"
        empty.mkdir()
        result = self.run_check(directory=empty)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("SKIP", result.stdout)

    def test_missing_xml_malformed_xml_and_stale_wrong_path_fail_closed(self):
        missing = self.run_check()
        self.assertNotEqual(missing.returncode, 0)
        self.xml.write_text("<test-run")
        self.assertNotEqual(self.run_check().returncode, 0)
        self.xml.write_text("<!DOCTYPE test-run [<!ENTITY a 'oops'>]><test-run />")
        self.assertIn("disallowed XML", self.run_check().stderr)
        self.set_xml()
        self.assertNotEqual(self.run_check(path=self.root / "old-run.xml").returncode, 0)
        redirect = self.root / "redirect.xml"
        redirect.symlink_to(self.xml)
        self.assertNotEqual(self.run_check(path=redirect).returncode, 0)

    def test_missing_skipped_failed_and_duplicate_wp6_result_fail_closed(self):
        self.set_xml(methods=["SourceMatches", "UnrelatedSuiteMethod"], total=2, passed=2)
        self.assertIn("missing from Unity run", self.run_check().stderr)
        self.set_xml(results={"SourceMatches": "Passed", "DirtySceneRejected": "Skipped"})
        self.assertIn("not passed", self.run_check().stderr)
        self.set_xml(results={"SourceMatches": "Passed", "DirtySceneRejected": "Failed"})
        self.assertNotEqual(self.run_check().returncode, 0)
        self.set_xml()
        tree = ET.parse(self.xml)
        assembly = tree.getroot().find("test-suite")
        assembly.append(ET.fromstring(ET.tostring(assembly.find("test-case"))))
        tree.getroot().set("total", "3")
        tree.getroot().set("passed", "3")
        tree.write(self.xml)
        self.assertIn("duplicate WP6 result", self.run_check().stderr)

    def test_renamed_method_or_wrong_name_is_not_counted(self):
        self.set_xml(methods=["SourceMatches", "SomeOtherTest"], total=2, passed=2)
        self.assertIn("missing from Unity run", self.run_check().stderr)
        self.set_xml()
        tree = ET.parse(self.xml)
        tree.getroot().find(".//test-case").set("methodname", "Bogus")
        tree.write(self.xml)
        self.assertIn("identity mismatched", self.run_check().stderr)

    def test_invalid_result_root_and_summary_rejects_green_runner(self):
        self.set_xml(passed=0, skipped=2)
        self.assertNotEqual(self.run_check().returncode, 0)
        self.set_xml(total=0)
        self.assertNotEqual(self.run_check().returncode, 0)
        self.set_xml(failed=1)
        self.assertNotEqual(self.run_check().returncode, 0)
        self.set_xml()
        tree = ET.parse(self.xml)
        tree.getroot().tag = "test-suite"
        tree.write(self.xml)
        self.assertNotEqual(self.run_check().returncode, 0)

    def test_unparsable_test_attribute_or_wrong_source_class_fails_closed(self):
        self.set_xml()
        self.set_source(suffix="\n [Test]\n")
        self.assertIn("unrecognized WP6 [Test]", self.run_check().stderr)
        self.set_source(methods=["SourceMatches", "DirtySceneRejected"],
                        suffix="\n [TestCase(1)]\n")
        self.assertIn("unsupported WP6 NUnit attribute", self.run_check().stderr)
        self.set_source(methods=["SourceMatches", "DirtySceneRejected"])
        p = self.src / (NAME + ".cs")
        p.write_text(p.read_text().replace("class " + NAME, "class DifferentName"))
        self.assertIn("class differs", self.run_check().stderr)

    def test_real_checkout_discovery_declares_expected_wp6_tests(self):
        real = Path(__file__).resolve().parent.parent / (
            "unity-package/com.eunsung.teamforge/Tests/Editor")
        if not list(real.glob("TeamForgeWp6*Tests.cs")):
            self.skipTest("No WP6 sources on this historical branch")
        self.set_xml()
        result = self.run_check(directory=real)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("WP6 Unity execution evidence refused", result.stderr,
                      "Real WP6 source names must be found, never ignored.")


if __name__ == "__main__":
    unittest.main()
