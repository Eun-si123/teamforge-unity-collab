"""Localized homepage URLs preserve explicit cache revisions."""
import unittest
from build_homepage_locales import BASE_URL, normalize_shared_asset_urls


class SharedAssetRevisionTests(unittest.TestCase):
    REGISTRY = {"sharedAssets": ["homepage.css", "homepage-motion.js", "assets/logo.png"]}

    def test_versioned_css_and_js_become_root_relative_in_locales(self):
        html = ('<link rel="stylesheet" href="homepage.css?v=release1">'
                '<script src="homepage-motion.js?v=release1"></script>'
                '<img src="assets/logo.png?size=2#preview">')
        output = normalize_shared_asset_urls(html, self.REGISTRY)
        for part in ("homepage.css?v=release1",
                     "homepage-motion.js?v=release1",
                     "assets/logo.png?size=2#preview"):
            self.assertIn(BASE_URL + part, output)
        self.assertNotIn('href="homepage.css?', output)
        self.assertNotIn('src="homepage-motion.js?', output)

    def test_unversioned_assets_and_longer_names_unchanged(self):
        html = ('<script src="homepage-motion.js"></script>'
                '<link href="homepage.css.map">'
                '<link href="homepage.css">'
                '<a href="https://third-party.example/homepage.css?v=external">ext</a>')
        output = normalize_shared_asset_urls(html, self.REGISTRY)
        self.assertIn(f'src="{BASE_URL}homepage-motion.js"', output)
        self.assertIn(f'href="{BASE_URL}homepage.css"', output)
        self.assertIn('href="homepage.css.map"', output)
        self.assertIn('https://third-party.example/homepage.css?v=external', output)

    def test_fragment_and_poster_query_remain_intact(self):
        html = '<video poster="assets/logo.png#frame"><source src="assets/logo.png?version=2"></video>'
        output = normalize_shared_asset_urls(html, self.REGISTRY)
        self.assertIn('poster="' + BASE_URL + 'assets/logo.png#frame"', output)
        self.assertIn('src="' + BASE_URL + 'assets/logo.png?version=2"', output)


if __name__ == "__main__":
    unittest.main()
