import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("status_source_delta.py")
spec = importlib.util.spec_from_file_location("status_source_delta", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

PIN_SCRIPT = Path(__file__).with_name("verify_localized_doc_revisions.py")
pin_spec = importlib.util.spec_from_file_location("verify_localized_doc_revisions", PIN_SCRIPT)
pins = importlib.util.module_from_spec(pin_spec)
pin_spec.loader.exec_module(pins)


def git(root, *args):
    subprocess.run(("git", *args), cwd=root, capture_output=True, text=True, check=True)


def commit(root, message):
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", message)


class LiveStatusTests(unittest.TestCase):
    def test_default_npm_test_catches_stale_translation_pins_before_pages(self):
        project = Path(__file__).resolve().parents[1]
        scripts = json.loads((project / "package.json").read_text())["scripts"]
        self.assertIn("npm run test:status-live", scripts["test"])
        self.assertIn(
            "python3 scripts/verify_translation_review_pins.py .",
            scripts["test:status-live"],
            "Ordinary npm test must detect stale translated documents before the Pages build",
        )

    def test_localized_source_review_detects_a_changed_canonical_file(self):
        with tempfile.TemporaryDirectory(prefix="tf-status-pins-") as tmp:
            root = Path(tmp)
            (root / "docs").mkdir()
            (root / "site/i18n").mkdir(parents=True)
            source = root / "docs/STATUS.md"
            source.write_text("initial source\n")
            (root / "docs/STATUS.ko.md").write_text("localized source\n")
            registry = {
                "schemaVersion": 1, "defaultLocale": "en",
                "locales": [
                    {"code": "en", "publish": True},
                    {"code": "ko", "publish": True, "documents": {
                        "status/": {
                            "repoSource": "docs/STATUS.ko.md",
                            "sourceRepoSource": "docs/STATUS.md",
                            "reviewedSourceBlob": pins.git_blob(root, "docs/STATUS.md"),
                        },
                    }},
                ],
            }
            self.assertEqual(pins.verify_localized_doc_revisions(root, registry), 1)
            source.write_text("revised canonical source\n")
            with self.assertRaisesRegex(RuntimeError, "requires translation review"):
                pins.verify_localized_doc_revisions(root, registry)
            registry["locales"][1]["documents"]["status/"]["reviewedSourceBlob"] = pins.git_blob(
                root, "docs/STATUS.md"
            )
            self.assertEqual(pins.verify_localized_doc_revisions(root, registry), 1)

    def test_homepage_only_locale_rejects_unreviewed_source_changes(self):
        pin_module = Path(__file__).with_name("verify_translation_review_pins.py")
        spec = importlib.util.spec_from_file_location("translation_review_pins", pin_module)
        review = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(review)

        with tempfile.TemporaryDirectory(prefix="tf-homepage-pins-") as tmp:
            root = Path(tmp)
            (root / "docs").mkdir()
            (root / "site/i18n").mkdir(parents=True)
            source = root / "docs/STATUS.md"
            source.write_text("initial source\n")
            manifest = root / "site/i18n/homepage.nl.json"
            manifest.write_text(json.dumps({
                "schemaVersion": 1, "locale": "nl",
                "reviewedSources": {"docs/STATUS.md": pins.git_blob(root, "docs/STATUS.md")},
            }))
            (root / "site/i18n/locales.json").write_text(json.dumps({
                "schemaVersion": 1, "defaultLocale": "en",
                "locales": [
                    {"code": "en", "label": "English", "htmlLang": "en",
                     "hreflang": "en", "path": "", "publish": True},
                    {"code": "nl", "label": "Nederlands", "htmlLang": "nl",
                     "hreflang": "nl", "path": "nl/", "publish": True,
                     "homepageManifest": "site/i18n/homepage.nl.json"},
                ],
            }))
            # No long-form translation exists; only a homepage review pin.
            self.assertEqual(review.verify_reviewed_sources(root), (0, 1))
            source.write_text("revised canonical source\n")
            with self.assertRaisesRegex(RuntimeError, "nl homepage translation review is required"):
                review.verify_reviewed_sources(root)
            data = json.loads(manifest.read_text())
            data["reviewedSources"]["docs/STATUS.md"] = pins.git_blob(root, "docs/STATUS.md")
            manifest.write_text(json.dumps(data))
            self.assertEqual(review.verify_reviewed_sources(root), (0, 1))

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
