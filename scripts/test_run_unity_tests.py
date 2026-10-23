"""Exercise the shell wrapper with a synthetic Editor, without requiring Unity."""

import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
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
            "import os, pathlib, sys, time\n"
            "args = sys.argv[1:]\n"
            "pathlib.Path(os.environ['TF_FIXTURE_MARKER']).write_text(args[args.index('-testResults') + 1])\n"
            "release = os.environ.get('TF_FIXTURE_RELEASE')\n"
            "deadline = time.monotonic() + 8\n"
            "while release and not pathlib.Path(release).exists():\n"
            "    if time.monotonic() > deadline: sys.exit(9)\n"
            "    time.sleep(0.01)\n"
            "xml = os.environ.get('TF_FIXTURE_XML')\n"
            "if xml is not None:\n"
            "    pathlib.Path(args[args.index('-testResults') + 1]).write_text(xml)\n"
            "if os.environ.get('TF_FIXTURE_LOG') == '1':\n"
            "    pathlib.Path(args[args.index('-logFile') + 1]).write_text('fresh log')\n"
            "sys.exit(int(os.environ.get('TF_FIXTURE_EXIT', '0')))\n",
            encoding="utf-8",
        )
        self.editor.chmod(0o755)

    def editor_environment(self, xml=None, editor_exit=0, extra_env=None):
        env = {key: value for key, value in os.environ.items() if not key.startswith("TF_FIXTURE_")}
        env.update(UNITY_EDITOR=str(self.editor), TF_FIXTURE_MARKER=str(self.marker),
                   TF_FIXTURE_EXIT=str(editor_exit))
        if xml is not None:
            env["TF_FIXTURE_XML"] = xml
        env.update(extra_env or {})
        return env

    def run_helper(self, xml=None, editor_exit=0, extra_env=None):
        env = self.editor_environment(xml, editor_exit, extra_env)
        return subprocess.run(["/bin/bash", str(self.script)], env=env, text=True,
                              capture_output=True, timeout=10, cwd=self.root)

    def test_concurrent_editors_cannot_share_passing_results(self):
        missing_marker, passing_marker = self.root / "missing-started", self.root / "passing-started"
        missing_release, passing_release = self.root / "release-missing", self.root / "release-passing"
        children = []

        def start(xml, marker, release):
            child = subprocess.Popen(
                ["/bin/bash", str(self.script)], cwd=self.root, text=True,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                env=self.editor_environment(xml, extra_env={
                    "TF_FIXTURE_MARKER": str(marker), "TF_FIXTURE_RELEASE": str(release),
                }),
            )
            children.append(child)
            deadline = time.monotonic() + 5
            while not marker.exists():
                self.assertIsNone(child.poll(), "Synthetic Editor exited before reaching its gate.")
                self.assertLess(time.monotonic(), deadline, "Synthetic Editor did not reach its gate.")
                time.sleep(0.01)
            return child

        try:
            # Both wrappers finish preparing their output paths before either
            # Editor publishes anything. Then only the second Editor writes XML.
            missing = start(None, missing_marker, missing_release)
            passing = start(PASSING_XML, passing_marker, passing_release)
            passing_release.touch()
            stdout, stderr = passing.communicate(timeout=5)
            self.assertEqual(passing.returncode, 0, stdout + stderr)
            missing_release.touch()
            stdout, stderr = missing.communicate(timeout=5)
            self.assert_rejected(subprocess.CompletedProcess(missing.args, missing.returncode, stdout, stderr))
            self.assertNotEqual(missing_marker.read_text(), passing_marker.read_text(),
                                "Concurrent runs must receive distinct result paths.")
            self.assertEqual(Path(passing_marker.read_text()).read_text(), PASSING_XML,
                             "Failed concurrent run must preserve the successful run's evidence.")
        finally:
            missing_release.touch()
            passing_release.touch()
            for child in children:
                try:
                    child.communicate(timeout=5)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.communicate(timeout=5)

    def assert_rejected(self, result):
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn("Unity EditMode results:", result.stdout)

    def result_file(self, result):
        prefix = "Unity EditMode results: "
        lines = [line for line in result.stdout.splitlines() if line.startswith(prefix)]
        self.assertEqual(len(lines), 1, result.stdout + result.stderr)
        return Path(lines[0][len(prefix):])

    def test_missing_results_rejected_after_zero_exit(self):
        result = self.run_helper()
        self.assertTrue(self.marker.exists(), "The synthetic Editor must actually run.")
        self.assert_rejected(result)

    def test_stale_passing_results_and_log_cannot_satisfy_a_new_run(self):
        self.results.parent.mkdir(parents=True)
        self.results.write_text(PASSING_XML)
        self.log.write_text("old log")
        self.assert_rejected(self.run_helper())
        self.assertEqual(self.results.read_text(), PASSING_XML, "Previous evidence must be preserved.")
        self.assertEqual(self.log.read_text(), "old log", "Previous logs must be preserved.")
        runs = list(self.results.parent.glob("run.*"))
        self.assertEqual(len(runs), 1)
        self.assertFalse((runs[0] / self.results.name).exists(), "Only this invocation's XML can satisfy validation.")

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
        results = self.result_file(result)
        self.assertEqual(results.read_text(), PASSING_XML)
        self.assertEqual(results.with_name("unity-editor.log").read_text(), "fresh log")
        self.assertNotEqual(results, self.results)

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
