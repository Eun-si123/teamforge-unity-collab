"""Exercise the shell wrapper with a synthetic Editor, without requiring Unity."""

import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


HELPER = Path(__file__).with_name("run-unity-tests.sh")
PASSING_XML = (
    '<test-run result="Passed" total="3" passed="2" failed="0" '
    'skipped="1" inconclusive="0"><test-suite /></test-run>'
)


class UnityShellTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="teamforge unity wrapper ")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / "scripts").mkdir()
        (self.root / "unity-project").mkdir()
        self.script = self.root / "scripts" / HELPER.name
        shutil.copyfile(HELPER, self.script)
        self.results = self.root / "artifacts/unity-tests/editmode-results.xml"
        self.log = self.results.with_name("unity-editor.log")
        self.marker = self.root / "editor-started"
        self.editor = self.root / "synthetic Editor with spaces"
        self.editor.write_text(
            "#!" + sys.executable + "\n"
            "import os, pathlib, sys\n"
            "pathlib.Path(os.environ['TF_FIXTURE_MARKER']).write_text('started')\n"
            "args = sys.argv[1:]\n"
            "xml = os.environ.get('TF_FIXTURE_XML')\n"
            "if xml is not None:\n"
            "    pathlib.Path(args[args.index('-testResults') + 1]).write_text(xml)\n"
            "if os.environ.get('TF_FIXTURE_LOG') == '1':\n"
            "    pathlib.Path(args[args.index('-logFile') + 1]).write_text('fresh log')\n"
            "sys.exit(int(os.environ.get('TF_FIXTURE_EXIT', '0')))\n",
            encoding="utf-8",
        )
        self.editor.chmod(0o755)

    def run_helper(self, xml=None, editor_exit=0, extra_env=None):
        env = {key: value for key, value in os.environ.items() if not key.startswith("TF_FIXTURE_")}
        env.update(UNITY_EDITOR=str(self.editor), TF_FIXTURE_MARKER=str(self.marker),
                   TF_FIXTURE_EXIT=str(editor_exit))
        if xml is not None:
            env["TF_FIXTURE_XML"] = xml
        env.update(extra_env or {})
        return subprocess.run(["/bin/bash", str(self.script)], env=env, text=True,
                              capture_output=True, timeout=10, cwd=self.root)

    def assert_rejected(self, result):
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn("Unity EditMode results:", result.stdout)

    def test_missing_results_rejected_after_zero_exit(self):
        result = self.run_helper()
        self.assertTrue(self.marker.exists(), "The synthetic Editor must actually run.")
        self.assert_rejected(result)

    def test_stale_passing_results_and_log_cannot_satisfy_a_new_run(self):
        self.results.parent.mkdir(parents=True)
        self.results.write_text(PASSING_XML)
        self.log.write_text("old log")
        self.assert_rejected(self.run_helper())
        self.assertFalse(self.results.exists(), "Old passing XML must be removed before launch.")
        self.assertFalse(self.log.exists(), "Old logs must not masquerade as current evidence.")

    def test_invalid_xml_and_non_passing_counts_rejected(self):
        invalid = {
            "empty": "",
            "malformed": "<test-run",
            "wrong root": PASSING_XML.replace("test-run", "test-suite"),
            "missing count": PASSING_XML.replace(' passed="2"', ""),
            "zero tests": PASSING_XML.replace('total="3" passed="2"', 'total="0" passed="0"').replace('skipped="1"', 'skipped="0"'),
            "skipped only": PASSING_XML.replace('passed="2"', 'passed="0"').replace('skipped="1"', 'skipped="3"'),
            "inconclusive": PASSING_XML.replace('skipped="1" inconclusive="0"', 'skipped="0" inconclusive="1"'),
            "failed": PASSING_XML.replace('skipped="1"', 'skipped="0"').replace('failed="0"', 'failed="1"'),
            "failure result": PASSING_XML.replace('result="Passed"', 'result="Failed"'),
            "inconsistent": PASSING_XML.replace('total="3"', 'total="4"'),
            "negative": PASSING_XML.replace('passed="2"', 'passed="4"').replace('skipped="1"', 'skipped="-1"'),
            "fractional": PASSING_XML.replace('passed="2"', 'passed="2.0"'),
        }
        for name, xml in invalid.items():
            with self.subTest(name=name):
                self.assert_rejected(self.run_helper(xml))

    def test_positive_run_with_intentional_skips_and_spaced_paths(self):
        result = self.run_helper(PASSING_XML, extra_env={"TF_FIXTURE_LOG": "1"})
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Unity EditMode results:", result.stdout)
        self.assertEqual(self.results.read_text(), PASSING_XML)
        self.assertEqual(self.log.read_text(), "fresh log")

    def test_all_passed_run_succeeds(self):
        result = self.run_helper(PASSING_XML.replace('total="3"', 'total="2"').replace('skipped="1"', 'skipped="0"'))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_nonzero_editor_exit_is_preserved_even_with_passing_xml(self):
        result = self.run_helper(PASSING_XML, editor_exit=7)
        self.assertEqual(result.returncode, 7, result.stdout + result.stderr)
        self.assertNotIn("Unity EditMode results:", result.stdout)

    def test_python_is_required_before_editor_launch(self):
        result = self.run_helper(PASSING_XML, extra_env={"PATH": str(self.root / "missing-tools")})
        self.assert_rejected(result)
        self.assertIn("python3", result.stderr)
        self.assertFalse(self.marker.exists())


if __name__ == "__main__":
    unittest.main()
