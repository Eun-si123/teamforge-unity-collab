import importlib.util
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("status_source_delta.py")
spec = importlib.util.spec_from_file_location("status_source_delta", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def git(root, *args):
    subprocess.run(("git", *args), cwd=root, capture_output=True, text=True, check=True)


def commit(root, message):
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", message)


class LiveStatusTests(unittest.TestCase):
    def test_source_delta_is_not_confused_with_document_updates(self):
        with tempfile.TemporaryDirectory(prefix="tf-live-status-") as tmp:
            root = Path(tmp)
            git(root, "init", "-q")
            git(root, "config", "user.name", "Fixture Agent")
            git(root, "config", "user.email", "fixture@example.invalid")
            (root / "docs").mkdir()
            (root / "server").mkdir()
            (root / "docs/STATUS.md").write_text("evidence snapshot\n")
            (root / "server/index.mjs").write_text("export const ok = true;\n")
            commit(root, "baseline")
            self.assertEqual(module.report(root)["state"], "NO_TRACKED_SOURCE_COMMITS")
            (root / "server/index.mjs").write_text("export const ok = false;\n")
            commit(root, "change server")
            evidence = module.report(root)
            self.assertEqual(evidence["state"], "SOURCE_ADVANCED")
            self.assertEqual(evidence["sourceCommits"], 1)
            self.assertEqual(evidence["byArea"]["server"], 1)
            self.assertIn("never advance automatically", module.markdown(evidence))
            (root / "docs/README.md").write_text("docs-only\n")
            commit(root, "docs")
            self.assertEqual(module.report(root)["sourceCommits"], 1)
            (root / "docs/STATUS.md").write_text("updated evidence review\n")
            commit(root, "status")
            self.assertEqual(module.report(root)["state"], "NO_TRACKED_SOURCE_COMMITS")
            (root / "release-contract.json").write_text("{}")
            commit(root, "release contract change")
            self.assertEqual(module.report(root)["byArea"]["release-contract"], 1)

    def test_missing_status_revision_is_unknown_not_success(self):
        with tempfile.TemporaryDirectory(prefix="tf-live-status-missing-") as tmp:
            root = Path(tmp)
            git(root, "init", "-q")
            with self.assertRaisesRegex(ValueError, "No tracked docs/STATUS.md revision"):
                module.report(root)


if __name__ == "__main__":
    unittest.main()
