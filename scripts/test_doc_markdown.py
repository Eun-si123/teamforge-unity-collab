"""Regressions observed while reviewing the generated documentation in a browser."""
import unittest
from doc_markdown import render_markdown

class DocumentRendering(unittest.TestCase):
    def test_code_inside_link_keeps_text_and_code_semantics(self):
        result = render_markdown('[`release-contract.json`](../release-contract.json)', 'docs/architecture.md')
        self.assertIn('<code>release-contract.json</code></a>', result)
        self.assertNotIn('@@TF', result)
    def test_warning_keeps_content_and_emphasis_without_raw_gfm_marker(self):
        result = render_markdown('> [!WARNING]\n> **Early Public Preview**\n\n_Last review_', 'docs/STATUS.md')
        self.assertIn('notice-warning', result)
        self.assertIn('<strong>Early Public Preview</strong>', result)
        self.assertIn('<em>Last review</em>', result)
        self.assertNotIn('[!WARNING]', result)
    def test_inline_html_remains_escaped(self):
        result = render_markdown('<script>alert(1)</script>', 'docs/example.md')
        self.assertNotIn('<script>', result)

class LocalizedDocumentNavigation(unittest.TestCase):
    def test_explicit_english_link_leaves_active_locale(self):
        from pathlib import Path
        from build_homepage_locales import load_registry, locale_by_code
        from render_doc_pages import build_page, PAGES, BASE_URL
        registry = load_registry(Path(__file__).resolve().parent.parent)
        page = next(page for page in PAGES if page['slug'] == 'status')
        for code in ('ko', 'zh-Hans'):
            with self.subTest(locale=code):
                result = build_page(page, '# Status\n\n[English](STATUS.md)', {}, registry, locale_by_code(registry, code))
                self.assertIn(f'<a href="{BASE_URL}status/">English</a>', result)
                self.assertNotIn(f'<a href="{BASE_URL}{code}/status/">English</a>', result)

class SharedReadingDesign(unittest.TestCase):
    def test_all_document_routes_use_native_brand_layout(self):
        from pathlib import Path
        from build_homepage_locales import load_registry, locale_by_code
        from render_doc_pages import build_page, PAGES, document_url, route_for
        registry = load_registry(Path(__file__).resolve().parent.parent)
        for locale_code in ('en', 'ko', 'ja'):
            locale = locale_by_code(registry, locale_code)
            for page in PAGES:
                if document_url(registry, locale, route_for(page)) is None:
                    continue  # Partial translation coverage is explicit in locale registry.
                with self.subTest(locale=locale_code, route=page['slug']):
                    source = (Path(__file__).resolve().parent.parent / 'site/docs-hub.json').read_text() if page['slug'] == 'docs' else '# Example\n\nThis is text.'
                    markup = build_page(page, source, {}, registry, locale)
                    self.assertIn('reading-design.css', markup)
                    self.assertIn(f'class="site-reading doc-{page["slug"]}"', markup)
                    self.assertIn('class="doc-main"', markup)
                    self.assertIn('class="doc-header"', markup)
                    self.assertIn('site-theme.css', markup)
                    self.assertIn('theme-toggle.js', markup)

    def test_base_styles_are_shared_but_homepage_visuals_are_scoped(self):
        from pathlib import Path
        root = Path(__file__).resolve().parent.parent
        reading = (root / 'site' / 'reading-design.css').read_text()
        self.assertIn('.site-reading', reading)
        self.assertNotIn('.site-home', reading)
        homepage = (root / 'site' / 'homepage.css').read_text()
        self.assertIn('.site-home', homepage)
        self.assertNotIn('.site-reading', homepage)

if __name__ == '__main__': unittest.main()
