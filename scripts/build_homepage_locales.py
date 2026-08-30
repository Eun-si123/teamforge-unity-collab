#!/usr/bin/env python3
"""Build first-class localized TeamForge landing pages from the finalized English homepage.

The English homepage is enriched first by build-agent-web.py. This module then:
- keeps the English page as the structural source of truth;
- normalizes the shared language selector and language section;
- copies the development capture into the deployed site so localized pages do not rely on a GitHub blob URL;
- creates localized homepage variants by exact, reviewable replacements;
- rewrites localized metadata, JSON-LD, and links;
- fails closed when the reviewed English sources drift or structural parity is lost.

Long-form documentation remains owned by the Markdown localization pipeline in render_doc_pages.py.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
from pathlib import Path

BASE_URL = "https://eun-si123.github.io/teamforge-unity-collab/"
REPOSITORY_URL = "https://github.com/Eun-si123/teamforge-unity-collab"
MANIFEST_PATH = Path("site/i18n/homepage.ko.json")
SOURCE_CAPTURE = Path("TeamForge-readme-demo-hq-1280-12fps.gif")
DEPLOYED_CAPTURE = Path("assets/teamforge-demo.gif")
LOCALE_STYLE_START = "<!-- teamforge-locale-menu-style:start -->"
LOCALE_STYLE_END = "<!-- teamforge-locale-menu-style:end -->"

LOCALE_STYLE = r"""
  /* teamforge-locale-menu-style:start */
  .locale-menu { position: relative; }
  .locale-menu summary { list-style: none; cursor: pointer; color: var(--muted); user-select: none; white-space: nowrap; }
  .locale-menu summary::-webkit-details-marker { display: none; }
  .locale-menu summary::after { content: "▾"; margin-left: .38rem; color: var(--quiet); font-size: .72em; }
  .locale-menu[open] summary, .locale-menu summary:hover { color: #fff; }
  .locale-menu-popover { position: absolute; right: 0; top: calc(100% + .7rem); min-width: 150px; padding: .42rem; border: 1px solid var(--line-strong); background: #202328; box-shadow: 0 18px 46px rgba(0,0,0,.3); z-index: 80; }
  .locale-menu-popover a, .locale-menu-popover strong { display: block; padding: .48rem .58rem; border-radius: 2px; text-decoration: none; font-size: .82rem; font-weight: 560; }
  .locale-menu-popover a { color: #cfd3d8; }
  .locale-menu-popover a:hover { background: #2a2d32; color: #fff; }
  .locale-menu-popover strong { color: #fff; background: #2a2d32; }
  @media (max-width: 800px) {
    .locale-menu { margin-left: auto; }
    .locale-menu-popover { right: 0; }
  }
  /* teamforge-locale-menu-style:end */
""".strip()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("repo_root", type=Path)
    parser.add_argument("site_root", type=Path)
    parser.add_argument("--verify-only", action="store_true")
    return parser.parse_args()


def git_blob(repo_root: Path, relative: str) -> str:
    return subprocess.check_output(
        ["git", "rev-parse", f"HEAD:{relative}"],
        cwd=repo_root,
        text=True,
        stderr=subprocess.STDOUT,
    ).strip()


def load_manifest(repo_root: Path) -> dict[str, object]:
    manifest_file = repo_root / MANIFEST_PATH
    if not manifest_file.is_file():
        raise RuntimeError(f"missing homepage locale manifest: {MANIFEST_PATH}")
    manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
    if manifest.get("schemaVersion") != 1 or manifest.get("locale") != "ko":
        raise RuntimeError("homepage.ko.json has unsupported schema or locale")

    reviewed = manifest.get("reviewedSources")
    if not isinstance(reviewed, dict) or not reviewed:
        raise RuntimeError("homepage.ko.json must record reviewedSources")
    for relative, expected in reviewed.items():
        actual = git_blob(repo_root, str(relative))
        if actual != expected:
            raise RuntimeError(
                "Korean homepage translation review is required because a reviewed English source changed: "
                f"{relative} expected {expected}, got {actual}"
            )
    return manifest


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label} changed unexpectedly: expected 1 match, got {count}")
    return text.replace(old, new, 1)


def inject_locale_style(text: str) -> str:
    if LOCALE_STYLE_START in text or LOCALE_STYLE_END in text:
        return text
    marker = "</head>"
    if marker not in text:
        raise RuntimeError("homepage is missing </head>")
    block = f"{LOCALE_STYLE_START}\n<style>\n{LOCALE_STYLE}\n</style>\n{LOCALE_STYLE_END}\n"
    return text.replace(marker, block + marker, 1)


def locale_menu(active: str) -> str:
    if active == "ko":
        return (
            '<details class="locale-menu"><summary aria-label="언어 선택">🌐 한국어</summary>'
            '<div class="locale-menu-popover" role="group" aria-label="언어">'
            f'<a href="{BASE_URL}" lang="en" hreflang="en" translate="no">English</a>'
            '<strong lang="ko" translate="no">한국어</strong>'
            '</div></details>'
        )
    return (
        '<details class="locale-menu"><summary aria-label="Choose language">🌐 English</summary>'
        '<div class="locale-menu-popover" role="group" aria-label="Languages">'
        '<strong lang="en" translate="no">English</strong>'
        f'<a href="{BASE_URL}ko/" lang="ko" hreflang="ko" translate="no">한국어</a>'
        '</div></details>'
    )


def language_section(active: str) -> str:
    if active == "ko":
        return f'''    <section id="language"><div class="wrap"><span class="section-index">언어 / 07</span><h2>TeamForge를 원하는 언어로 읽기.</h2><div class="split ko"><p>영어와 한국어 홈페이지는 같은 제품 페이지 구조를 공유하며 각각 독립적인 정적 URL로 배포됩니다. 언어를 바꿔도 다른 종류의 페이지로 이동하지 않습니다.</p><p>한국어로 번역되지 않은 긴 기술 문서는 영어 원문을 유지합니다. 번역이 존재하는 문서만 별도 한국어 URL로 게시하고, 영어 원문 변경 뒤에는 번역 검토 상태를 다시 확인합니다.</p></div><div class="actions"><a class="btn" href="{BASE_URL}">English site</a><a class="btn" href="{BASE_URL}ko/status/">현재 상태</a><a class="btn" href="{BASE_URL}ko/how-it-works/">작동 방식</a><a class="btn" href="{REPOSITORY_URL}/blob/main/docs/SITE_LOCALIZATION.md">현지화 정책</a></div></div></section>'''
    return f'''    <section id="language"><div class="wrap"><span class="section-index">Language / 07</span><h2>Read TeamForge in your language.</h2><div class="split ko"><p>The English and Korean homepages share the same product-page structure and are deployed as independent static URLs. Switching language should not send someone to a different kind of page.</p><p>Long-form technical documentation stays in English when a maintained translation does not exist. Only real translations receive localized URLs, and translation review is required again when reviewed English sources change.</p></div><div class="actions"><a class="btn" href="{BASE_URL}ko/">한국어 사이트</a><a class="btn" href="{BASE_URL}status/">Current status</a><a class="btn" href="{BASE_URL}how-it-works/">How it works</a><a class="btn" href="{REPOSITORY_URL}/blob/main/docs/SITE_LOCALIZATION.md">Localization policy</a></div></div></section>'''


def normalize_english_homepage(repo_root: Path, site_root: Path, text: str) -> str:
    source_capture = repo_root / SOURCE_CAPTURE
    if not source_capture.is_file() or source_capture.stat().st_size == 0:
        raise RuntimeError(f"missing development capture: {SOURCE_CAPTURE}")
    deployed_capture = site_root / DEPLOYED_CAPTURE
    deployed_capture.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source_capture, deployed_capture)

    raw_capture = (
        "https://raw.githubusercontent.com/Eun-si123/teamforge-unity-collab/main/"
        "TeamForge-readme-demo-hq-1280-12fps.gif"
    )
    if raw_capture in text:
        text = text.replace(raw_capture, BASE_URL + DEPLOYED_CAPTURE.as_posix())

    legacy_language_link = (
        f'<a href="{BASE_URL}ko/" lang="ko" hreflang="ko" translate="no" '
        'title="한국어 사이트">한국어</a>'
    )
    text = replace_once(text, legacy_language_link, locale_menu("en"), "homepage language control")

    pattern = re.compile(r'    <section id="korean">.*?</section>', re.DOTALL)
    text, count = pattern.subn(language_section("en"), text, count=1)
    if count != 1:
        raise RuntimeError(f"legacy Korean homepage section changed unexpectedly: {count} matches")

    text = inject_locale_style(text)
    return text


def replace_tag_content(text: str, tag_pattern: str, replacement: str, label: str) -> str:
    text, count = re.subn(tag_pattern, replacement, text, count=1, flags=re.DOTALL)
    if count != 1:
        raise RuntimeError(f"{label} changed unexpectedly: {count} matches")
    return text


def localize_json_ld(text: str, manifest: dict[str, object]) -> str:
    canonical = BASE_URL + "ko/"
    description = str((manifest.get("metadata") or {}).get("description") or "")
    pattern = re.compile(
        r'(<script type="application/ld\+json">\s*)(\{.*?\})(\s*</script>)',
        re.DOTALL,
    )

    def rewrite(match: re.Match[str]) -> str:
        try:
            payload = json.loads(match.group(2))
        except json.JSONDecodeError:
            return match.group(0)
        if payload.get("@type") != "SoftwareSourceCode":
            return match.group(0)
        payload["url"] = canonical
        payload["mainEntityOfPage"] = canonical
        payload["inLanguage"] = "ko"
        if description:
            payload["description"] = description
        for item in payload.get("subjectOf", []):
            if not isinstance(item, dict):
                continue
            if item.get("url") == BASE_URL + "status/":
                item["url"] = BASE_URL + "ko/status/"
                item["name"] = "TeamForge 현재 상태"
            elif item.get("url") == BASE_URL + "how-it-works/":
                item["url"] = BASE_URL + "ko/how-it-works/"
                item["name"] = "TeamForge 작동 방식"
        body = json.dumps(payload, ensure_ascii=False, indent=2)
        return match.group(1) + body + match.group(3)

    text, count = pattern.subn(rewrite, text)
    if count < 1 or '"inLanguage": "ko"' not in text:
        raise RuntimeError("could not localize homepage JSON-LD")
    return text


def apply_manifest(text: str, manifest: dict[str, object]) -> str:
    replacements = manifest.get("replacements")
    if not isinstance(replacements, list) or not replacements:
        raise RuntimeError("homepage.ko.json must contain replacements")
    for rule in replacements:
        if not isinstance(rule, dict):
            raise RuntimeError("homepage replacement rule must be an object")
        source = str(rule.get("source") or "")
        target = str(rule.get("target") or "")
        if not source:
            raise RuntimeError("homepage replacement rule is missing source")
        count = text.count(source)
        expected = rule.get("count")
        if expected is not None and count != int(expected):
            raise RuntimeError(
                f"homepage translation anchor changed: {source!r} expected {expected}, got {count}"
            )
        if expected is None and count < 1:
            raise RuntimeError(f"homepage translation anchor disappeared: {source!r}")
        text = text.replace(source, target)
    return text


def build_korean_homepage(english: str, manifest: dict[str, object]) -> str:
    metadata = manifest.get("metadata")
    if not isinstance(metadata, dict):
        raise RuntimeError("homepage.ko.json is missing metadata")
    canonical = BASE_URL + "ko/"

    text = replace_once(english, '<html lang="en">', '<html lang="ko">', "homepage html lang")
    text = replace_tag_content(
        text,
        r'<title>.*?</title>',
        f'<title>{metadata["title"]}</title>',
        "homepage title",
    )
    text = replace_tag_content(
        text,
        r'<meta name="description" content="[^"]*">',
        f'<meta name="description" content="{metadata["description"]}">',
        "homepage description",
    )
    text = replace_tag_content(
        text,
        r'<meta property="og:title" content="[^"]*">',
        f'<meta property="og:title" content="{metadata["ogTitle"]}">',
        "homepage og:title",
    )
    text = replace_tag_content(
        text,
        r'<meta property="og:description" content="[^"]*">',
        f'<meta property="og:description" content="{metadata["ogDescription"]}">',
        "homepage og:description",
    )
    text = replace_once(
        text,
        f'<link rel="canonical" href="{BASE_URL}">',
        f'<link rel="canonical" href="{canonical}">',
        "homepage canonical",
    )
    text = replace_once(
        text,
        f'<meta property="og:url" content="{BASE_URL}">',
        f'<meta property="og:url" content="{canonical}">',
        "homepage og:url",
    )

    menu_pattern = re.compile(r'<details class="locale-menu">.*?</details>', re.DOTALL)
    text, count = menu_pattern.subn(locale_menu("ko"), text, count=1)
    if count != 1:
        raise RuntimeError(f"could not localize language menu: {count} matches")

    language_pattern = re.compile(r'    <section id="language">.*?</section>', re.DOTALL)
    text, count = language_pattern.subn(language_section("ko"), text, count=1)
    if count != 1:
        raise RuntimeError(f"could not localize language section: {count} matches")

    text = apply_manifest(text, manifest)

    # Route to a localized equivalent only when that maintained page actually exists.
    text = text.replace(f'href="{BASE_URL}status/"', f'href="{BASE_URL}ko/status/"')
    text = text.replace(
        f'href="{BASE_URL}how-it-works/"', f'href="{BASE_URL}ko/how-it-works/"'
    )
    text = localize_json_ld(text, manifest)
    return text


def element_ids(text: str) -> list[str]:
    return re.findall(r'\bid="([^"]+)"', text)


def verify_homepages(site_root: Path, english: str, korean: str, manifest: dict[str, object]) -> None:
    if '<html lang="en">' not in english or '<html lang="ko">' not in korean:
        raise RuntimeError("homepage lang attributes are incomplete")
    if f'<link rel="canonical" href="{BASE_URL}">' not in english:
        raise RuntimeError("English homepage canonical is incorrect")
    if f'<link rel="canonical" href="{BASE_URL}ko/">' not in korean:
        raise RuntimeError("Korean homepage canonical is incorrect")

    for code, url in (("en", BASE_URL), ("ko", BASE_URL + "ko/"), ("x-default", BASE_URL)):
        needle = f'hreflang="{code}" href="{url}"'
        if needle not in english or needle not in korean:
            raise RuntimeError(f"homepage hreflang reciprocity missing: {needle}")

    english_ids = element_ids(english)
    korean_ids = element_ids(korean)
    if english_ids != korean_ids:
        raise RuntimeError("localized homepage DOM identity sequence drifted from English")
    for required in (
        "top",
        "demo",
        "collabLab",
        "lockButton",
        "resetButton",
        "proof",
        "status",
        "project-facts",
        "features",
        "history",
        "why",
        "language",
    ):
        if required not in english_ids:
            raise RuntimeError(f"homepage lost required structural id: {required}")

    if f'href="{BASE_URL}ko/status/"' not in korean:
        raise RuntimeError("Korean homepage does not link to localized status")
    if f'href="{BASE_URL}ko/how-it-works/"' not in korean:
        raise RuntimeError("Korean homepage does not link to localized How It Works")
    if "README.ko.md" in korean or "번역 원본" in korean:
        raise RuntimeError("Korean homepage regressed to the README-rendered landing page")

    for html_name, html_text in (("English", english), ("Korean", korean)):
        for src in re.findall(r'<img[^>]+src="([^"]+)"', html_text):
            if "github.com/" in src and "/blob/" in src:
                raise RuntimeError(f"{html_name} homepage contains a non-image GitHub blob URL: {src}")
        if BASE_URL + DEPLOYED_CAPTURE.as_posix() not in html_text:
            raise RuntimeError(f"{html_name} homepage does not use the deployed development capture")

    hangul_count = len(re.findall(r"[가-힣]", korean))
    if hangul_count < int(manifest.get("minimumHangulCharacters") or 500):
        raise RuntimeError(f"Korean homepage translation is unexpectedly sparse: {hangul_count}")
    forbidden = manifest.get("forbiddenEnglish") or []
    for phrase in forbidden:
        if str(phrase) in korean:
            raise RuntimeError(f"Korean homepage still contains untranslated core copy: {phrase!r}")

    capture = site_root / DEPLOYED_CAPTURE
    if not capture.is_file() or capture.stat().st_size == 0:
        raise RuntimeError("deployed homepage capture is missing/empty")


def build_homepage_locales(repo_root: Path, site_root: Path, *, verify_only: bool = False) -> None:
    repo_root = repo_root.resolve()
    site_root = site_root.resolve()
    manifest = load_manifest(repo_root)
    english_path = site_root / "index.html"
    korean_path = site_root / "ko" / "index.html"
    if not english_path.is_file():
        raise RuntimeError("built site is missing finalized English homepage")

    if verify_only:
        if not korean_path.is_file():
            raise RuntimeError("built site is missing Korean homepage")
        english = english_path.read_text(encoding="utf-8")
        korean = korean_path.read_text(encoding="utf-8")
        verify_homepages(site_root, english, korean, manifest)
        return

    english = normalize_english_homepage(repo_root, site_root, english_path.read_text(encoding="utf-8"))
    korean = build_korean_homepage(english, manifest)
    verify_homepages(site_root, english, korean, manifest)

    english_path.write_text(english, encoding="utf-8")
    korean_path.parent.mkdir(parents=True, exist_ok=True)
    korean_path.write_text(korean, encoding="utf-8")


def main() -> None:
    args = parse_args()
    build_homepage_locales(args.repo_root, args.site_root, verify_only=args.verify_only)


if __name__ == "__main__":
    main()
