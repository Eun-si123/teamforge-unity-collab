#!/usr/bin/env python3
"""Regression tests for IndexNow's source-aware, indexable HTML routing."""

import importlib.util
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("select-indexnow-urls.py")
SPEC = importlib.util.spec_from_file_location("teamforge_indexnow_selector_tests", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
selector = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(selector)
BASE = "https://eun-si123.github.io/teamforge-unity-collab/"


class IndexNowSelectionTests(unittest.TestCase):
    def urls(self, *paths):
        return selector.select_html_urls(set(paths))

    def test_unrelated_unity_or_workflow_changes_do_not_submit(self):
        self.assertEqual(
            self.urls("server/src/index.mjs", "docs/work-state/example.md",
                      ".github/workflows/indexnow.yml", "site/sitemap-test.txt"),
            [],
        )

    def test_english_status_changes_indexable_homepages_and_documents(self):
        self.assertEqual(
            self.urls("docs/STATUS.md"),
            sorted([BASE, BASE + "ko/", BASE + "status/", BASE + "ko/status/"]),
        )

    def test_korean_status_change_does_not_submit_preview_locales(self):
        self.assertEqual(self.urls("docs/STATUS.ko.md"), [BASE + "ko/status/"])
        self.assertEqual(self.urls("docs/STATUS.ja.md"), [])

    def test_single_document_routes_only_its_own_html(self):
        self.assertEqual(self.urls("site/about.md"), [BASE + "about/"])
        self.assertEqual(self.urls("docs/HOW_IT_WORKS.ko.md"), [BASE + "ko/how-it-works/"])

    def test_site_wide_css_change_reaches_only_indexable_html(self):
        urls = self.urls("site/site-theme.css")
        self.assertEqual(len(urls), 19)
        self.assertIn(BASE + "security/", urls)
        self.assertIn(BASE + "ko/docs/", urls)
        self.assertNotIn(BASE + "ja/", urls)
        self.assertFalse(any(not x.endswith("/") for x in urls))

    def test_localized_hub_change_is_scoped(self):
        self.assertEqual(self.urls("site/i18n/docs-hub.ko.json"), [BASE + "ko/docs/"])
        self.assertEqual(self.urls("site/i18n/docs-hub.ja.json"), [])

    def test_no_machine_readable_resources_or_duplicates(self):
        urls = self.urls("scripts/render_doc_pages.py", "docs/STATUS.md",
                         "release-contract.json")
        self.assertEqual(urls, sorted(set(urls)))
        self.assertTrue(all(url.endswith("/") for url in urls))
        self.assertNotIn(BASE + "sitemap.xml", urls)
        self.assertNotIn(BASE + "feed.atom", urls)

    def test_first_deployment_bootstraps_all_indexable_html(self):
        self.assertEqual(len(selector.select_html_urls(set(), all_pages=True)), 19)


if __name__ == "__main__":
    unittest.main()
