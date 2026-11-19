"""Safety regression tests for the generated public site credential guard."""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from verify_published_secrets import ArtifactError, inspect_site, main


class PublishGuardTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.site = Path(self.temp.name) / "site"
        self.site.mkdir()

    def test_clean_site_passes(self):
        (self.site / "index.html").write_text("<h1>TeamForge</h1>", encoding="utf-8")
        self.assertEqual(inspect_site(self.site), [])
        self.assertEqual(main(["verify_published_secrets.py", str(self.site)]), 0)

    def test_generated_html_private_token_blocks(self):
        (self.site / "index.html").write_bytes(b"key=" + b"sk_live_" + b"X" * 30)
        self.assertEqual(inspect_site(self.site), [("index.html", "Stripe private token")])
        self.assertEqual(main(["verify_published_secrets.py", str(self.site)]), 1)

    def test_nested_generated_javascript_blocks(self):
        (self.site / "scripts").mkdir()
        (self.site / "scripts" / "app.js").write_bytes(b"sk-proj-" + b"A" * 40)
        self.assertEqual(inspect_site(self.site), [("scripts/app.js", "OpenAI private token")])

    def test_missing_site_fails_closed(self):
        with self.assertRaises(ArtifactError):
            inspect_site(self.site / "missing")
        self.assertEqual(main(["verify_published_secrets.py", str(self.site / "missing")]), 2)


if __name__ == "__main__":
    unittest.main()
