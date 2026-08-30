#!/usr/bin/env python3
"""Build first-class localized TeamForge landing pages from one locale registry.

The finalized English homepage remains the structural source of truth. Published
locale manifests translate that same DOM, while site/i18n/locales.json owns
locale lifecycle, routing, language navigation, and hreflang participation.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import shutil
import subprocess
from pathlib import Path
from urllib.parse import urlparse

BASE_URL = "https://eun-si123.github.io/teamforge-unity-collab/"
REPOSITORY_URL = "https://github.com/Eun-si123/teamforge-unity-collab"
REGISTRY_PATH = Path("site/i18n/locales.json")
SOURCE_CAPTURE = Path("TeamForge-readme-demo-hq-1280-12fps.gif")
DEPLOYED_CAPTURE = Path("assets/teamforge-demo.gif")
LOCALE_STYLE_START = "<!-- teamforge-locale-menu-style:start -->"
LOCALE_STYLE_END = "<!-- teamforge-locale-menu-style:end -->"
I18N_HEAD_START = "<!-- teamforge-i18n-head:start -->"
I18N_HEAD_END = "<!-- teamforge-i18n-head:end -->"

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


def load_registry(repo_root: Path) -> dict[str, object]:
    registry_file = repo_root / REGISTRY_PATH
    if not registry_file.is_file():
        raise RuntimeError(f"missing locale registry: {REGISTRY_PATH}")
    registry = json.loads(registry_file.read_text(encoding="utf-8"))
    if registry.get("schemaVersion") != 1:
        raise RuntimeError("site/i18n/locales.json has an unsupported schema")

    raw_locales = registry.get("locales")
    if not isinstance(raw_locales, list) or not raw_locales:
        raise RuntimeError("locale registry must contain at least one locale")

    seen_codes: set[str] = set()
    seen_paths: set[str] = set()
    for locale in raw_locales:
        if not isinstance(locale, dict):
            raise RuntimeError("locale registry entries must be objects")
        code = str(locale.get("code") or "")
        path = str(locale.get("path") or "")
        if not code or code in seen_codes:
            raise RuntimeError(f"locale registry has a missing/duplicate code: {code!r}")
        if path.startswith("/") or (path and not path.endswith("/")):
            raise RuntimeError(f"locale {code} path must be relative and end with '/': {path!r}")
        if path in seen_paths:
            raise RuntimeError(f"locale registry has a duplicate path: {path!r}")
        if not locale.get("label") or not locale.get("htmlLang") or not locale.get("hreflang"):
            raise RuntimeError(f"locale {code} is missing label/htmlLang/hreflang")
        if locale.get("direction", "ltr") not in {"ltr", "rtl"}:
            raise RuntimeError(f"locale {code} direction must be ltr or rtl")
        if locale.get("publish", True) and code != registry.get("defaultLocale") and not locale.get("homepageManifest"):
            raise RuntimeError(f"published locale {code} is missing homepageManifest")
        seen_codes.add(code)
        seen_paths.add(path)

    default_code = str(registry.get("defaultLocale") or "")
    defaults = [locale for locale in raw_locales if locale.get("code") == default_code]
    if len(defaults) != 1:
        raise RuntimeError("locale registry defaultLocale must identify exactly one locale")
    if str(defaults[0].get("path") or "") != "":
        raise RuntimeError("default locale must use the site-root path")
    return registry


def locales(registry: dict[str, object], *, published_only: bool = False) -> list[dict[str, object]]:
    values = [item for item in registry["locales"] if isinstance(item, dict)]
    if published_only:
        values = [item for item in values if bool(item.get("publish", True))]
    return values


def locale_by_code(registry: dict[str, object], code: str) -> dict[str, object]:
    for locale in locales(registry):
        if locale.get("code") == code:
            return locale
    raise RuntimeError(f"unknown locale: {code}")


def locale_url(locale: dict[str, object]) -> str:
    return BASE_URL + str(locale.get("path") or "")


def load_manifest(repo_root: Path, locale: dict[str, object]) -> dict[str, object]:
    manifest_relative = str(locale.get("homepageManifest") or "")
    if not manifest_relative:
        raise RuntimeError(f"locale {locale['code']} has no homepage manifest")
    manifest_file = repo_root / manifest_relative
    if not manifest_file.is_file():
        raise RuntimeError(f"missing homepage locale manifest: {manifest_relative}")
    manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
    if manifest.get("schemaVersion") != 1 or manifest.get("locale") != locale.get("code"):
        raise RuntimeError(f"{manifest_relative} has unsupported schema or locale")

    reviewed = manifest.get("reviewedSources")
    if not isinstance(reviewed, dict) or not reviewed:
        raise RuntimeError(f"{manifest_relative} must record reviewedSources")
    for relative, expected in reviewed.items():
        # Locale manifests historically pinned this validator itself. Validator-only
        # refactors do not change translated product copy, so self-pins are ignored.
        if str(relative) == "scripts/build_homepage_locales.py":
            continue
        actual = git_blob(repo_root, str(relative))
        if actual != expected:
            raise RuntimeError(
                f"{locale['code']} homepage translation review is required because a reviewed source changed: "
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


def alternate_links(registry: dict[str, object]) -> str:
    default_locale = locale_by_code(registry, str(registry["defaultLocale"]))
    lines: list[str] = []
    for locale in locales(registry, published_only=True):
        if not bool(locale.get("indexable", True)):
            continue
        lines.append(
            f'  <link rel="alternate" hreflang="{html.escape(str(locale["hreflang"]), quote=True)}" '
            f'href="{html.escape(locale_url(locale), quote=True)}">'
        )
    lines.append(
        f'  <link rel="alternate" hreflang="x-default" '
        f'href="{html.escape(locale_url(default_locale), quote=True)}">'
    )
    return "\n".join(lines)


def normalize_hreflang(text: str, registry: dict[str, object]) -> str:
    block = f"{I18N_HEAD_START}\n{alternate_links(registry)}\n{I18N_HEAD_END}"
    pattern = re.compile(
        re.escape(I18N_HEAD_START) + r".*?" + re.escape(I18N_HEAD_END),
        re.DOTALL,
    )
    if pattern.search(text):
        return pattern.sub(block, text, count=1)

    canonical = re.search(r'^\s*<link rel="canonical"[^>]+>\s*$', text, re.MULTILINE)
    if canonical:
        return text[: canonical.end()] + "\n" + block + text[canonical.end():]
    marker = "</head>"
    if marker not in text:
        raise RuntimeError("homepage is missing </head> for hreflang injection")
    return text.replace(marker, block + "\n" + marker, 1)


def locale_menu(active_code: str, registry: dict[str, object]) -> str:
    active = locale_by_code(registry, active_code)
    aria = html.escape(str(active.get("menuAriaLabel") or "Choose language"), quote=True)
    group = html.escape(str(active.get("menuGroupLabel") or "Languages"), quote=True)
    active_label = html.escape(str(active["label"]))
    items: list[str] = []
    for locale in locales(registry, published_only=True):
        code = str(locale["code"])
        label = html.escape(str(locale["label"]))
        html_lang = html.escape(str(locale["htmlLang"]), quote=True)
        hreflang = html.escape(str(locale["hreflang"]), quote=True)
        if code == active_code:
            items.append(f'<strong lang="{html_lang}" translate="no">{label}</strong>')
        else:
            items.append(
                f'<a href="{html.escape(locale_url(locale), quote=True)}" lang="{html_lang}" '
                f'hreflang="{hreflang}" translate="no">{label}</a>'
            )
    return (
        f'<details class="locale-menu"><summary aria-label="{aria}">🌐 {active_label}</summary>'
        f'<div class="locale-menu-popover" role="group" aria-label="{group}">'
        + "".join(items)
        + "</div></details>"
    )


def language_section(locale: dict[str, object]) -> str:
    section = locale.get("languageSection")
    if not isinstance(section, dict):
        raise RuntimeError(f"locale {locale['code']} is missing languageSection")
    index = html.escape(str(section.get("index") or "Language / 07"))
    heading = html.escape(str(section.get("heading") or "Read TeamForge in your language."))
    paragraphs = section.get("paragraphs")
    actions = section.get("actions")
    if not isinstance(paragraphs, list) or not paragraphs:
        raise RuntimeError(f"locale {locale['code']} languageSection must contain paragraphs")
    if not isinstance(actions, list) or not actions:
        raise RuntimeError(f"locale {locale['code']} languageSection must contain actions")

    paragraph_html = "".join(f"<p>{html.escape(str(value))}</p>" for value in paragraphs)
    action_html: list[str] = []
    for action in actions:
        if not isinstance(action, dict) or not action.get("label") or action.get("href") is None:
            raise RuntimeError(f"locale {locale['code']} has an invalid languageSection action")
        href = str(action["href"])
        if not href.startswith(("http://", "https://", "#")):
            href = BASE_URL + href
        action_html.append(
            f'<a class="btn" href="{html.escape(href, quote=True)}">{html.escape(str(action["label"]))}</a>'
        )
    return (
        f'    <section id="language"><div class="wrap"><span class="section-index">{index}</span>'
        f'<h2>{heading}</h2><div class="split ko">{paragraph_html}</div>'
        f'<div class="actions">{"".join(action_html)}</div></div></section>'
    )


def normalize_english_homepage(
    repo_root: Path,
    site_root: Path,
    text: str,
    registry: dict[str, object],
) -> str:
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

    default_code = str(registry["defaultLocale"])
    legacy_language_link = (
        f'<a href="{BASE_URL}ko/" lang="ko" hreflang="ko" translate="no" '
        'title="한국어 사이트">한국어</a>'
    )
    if legacy_language_link in text:
        text = replace_once(
            text,
            legacy_language_link,
            locale_menu(default_code, registry),
            "homepage language control",
        )
    else:
        menu_pattern = re.compile(r'<details class="locale-menu">.*?</details>', re.DOTALL)
        text, count = menu_pattern.subn(locale_menu(default_code, registry), text, count=1)
        if count != 1:
            raise RuntimeError(f"homepage language control changed unexpectedly: {count} matches")

    legacy_section = re.compile(r'    <section id="korean">.*?</section>', re.DOTALL)
    if legacy_section.search(text):
        text, count = legacy_section.subn(
            language_section(locale_by_code(registry, default_code)), text, count=1
        )
    else:
        section_pattern = re.compile(r'    <section id="language">.*?</section>', re.DOTALL)
        text, count = section_pattern.subn(
            language_section(locale_by_code(registry, default_code)), text, count=1
        )
    if count != 1:
        raise RuntimeError(f"homepage language section changed unexpectedly: {count} matches")

    text = inject_locale_style(text)
    text = normalize_hreflang(text, registry)
    return text


def replace_tag_content(text: str, tag_pattern: str, replacement: str, label: str) -> str:
    text, count = re.subn(tag_pattern, replacement, text, count=1, flags=re.DOTALL)
    if count != 1:
        raise RuntimeError(f"{label} changed unexpectedly: {count} matches")
    return text


def localized_documents(locale: dict[str, object]) -> dict[str, dict[str, str]]:
    raw = locale.get("documents") or {}
    if not isinstance(raw, dict):
        raise RuntimeError(f"locale {locale['code']} documents must be an object")
    result: dict[str, dict[str, str]] = {}
    for source_path, target in raw.items():
        if not isinstance(target, dict) or not target.get("path"):
            raise RuntimeError(f"locale {locale['code']} has an invalid document route for {source_path}")
        result[str(source_path)] = {str(k): str(v) for k, v in target.items()}
    return result


def localize_json_ld(
    text: str,
    locale: dict[str, object],
    manifest: dict[str, object],
) -> str:
    canonical = locale_url(locale)
    description = str((manifest.get("metadata") or {}).get("description") or "")
    documents = localized_documents(locale)
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
        payload["inLanguage"] = str(locale["htmlLang"])
        if description:
            payload["description"] = description
        for item in payload.get("subjectOf", []):
            if not isinstance(item, dict):
                continue
            item_url = str(item.get("url") or "")
            for source_path, target in documents.items():
                if item_url != BASE_URL + source_path:
                    continue
                item["url"] = BASE_URL + target["path"]
                if target.get("jsonLdName"):
                    item["name"] = target["jsonLdName"]
                break
        body = json.dumps(payload, ensure_ascii=False, indent=2)
        return match.group(1) + body + match.group(3)

    text, count = pattern.subn(rewrite, text)
    marker = json.dumps(str(locale["htmlLang"]), ensure_ascii=False)
    if count < 1 or f'"inLanguage": {marker}' not in text:
        raise RuntimeError(f"could not localize homepage JSON-LD for {locale['code']}")
    return text


def apply_manifest(text: str, manifest: dict[str, object], locale_code: str) -> str:
    replacements = manifest.get("replacements")
    if not isinstance(replacements, list) or not replacements:
        raise RuntimeError(f"homepage manifest {locale_code} must contain replacements")
    for rule in replacements:
        if not isinstance(rule, dict):
            raise RuntimeError(f"homepage replacement rule for {locale_code} must be an object")
        source = str(rule.get("source") or "")
        target = str(rule.get("target") or "")
        if not source:
            raise RuntimeError(f"homepage replacement rule for {locale_code} is missing source")
        count = text.count(source)
        expected = rule.get("count")
        if expected is not None and count != int(expected):
            raise RuntimeError(
                f"homepage translation anchor changed for {locale_code}: "
                f"{source!r} expected {expected}, got {count}"
            )
        if expected is None and count < 1:
            raise RuntimeError(
                f"homepage translation anchor disappeared for {locale_code}: {source!r}"
            )
        text = text.replace(source, target)
    return text


def build_localized_homepage(
    english: str,
    locale: dict[str, object],
    manifest: dict[str, object],
    registry: dict[str, object],
) -> str:
    metadata = manifest.get("metadata")
    if not isinstance(metadata, dict):
        raise RuntimeError(f"homepage manifest {locale['code']} is missing metadata")
    canonical = locale_url(locale)
    html_lang = str(locale["htmlLang"])
    direction = str(locale.get("direction") or "ltr")
    replacement_html = f'<html lang="{html_lang}">'
    if direction == "rtl":
        replacement_html = f'<html lang="{html_lang}" dir="rtl">'

    text = replace_once(english, '<html lang="en">', replacement_html, "homepage html lang")
    text = replace_tag_content(
        text,
        r"<title>.*?</title>",
        f'<title>{html.escape(str(metadata["title"]))}</title>',
        "homepage title",
    )
    for prop, key in (
        ("description", "description"),
        ("og:title", "ogTitle"),
        ("og:description", "ogDescription"),
    ):
        if prop == "description":
            pattern = r'<meta name="description" content="[^"]*">'
            replacement = (
                f'<meta name="description" content="{html.escape(str(metadata[key]), quote=True)}">'
            )
        else:
            pattern = rf'<meta property="{re.escape(prop)}" content="[^"]*">'
            replacement = (
                f'<meta property="{prop}" content="{html.escape(str(metadata[key]), quote=True)}">'
            )
        text = replace_tag_content(text, pattern, replacement, f"homepage {prop}")

    default_locale = locale_by_code(registry, str(registry["defaultLocale"]))
    text = replace_once(
        text,
        f'<link rel="canonical" href="{locale_url(default_locale)}">',
        f'<link rel="canonical" href="{canonical}">',
        "homepage canonical",
    )
    text = replace_once(
        text,
        f'<meta property="og:url" content="{locale_url(default_locale)}">',
        f'<meta property="og:url" content="{canonical}">',
        "homepage og:url",
    )

    menu_pattern = re.compile(r'<details class="locale-menu">.*?</details>', re.DOTALL)
    text, count = menu_pattern.subn(locale_menu(str(locale["code"]), registry), text, count=1)
    if count != 1:
        raise RuntimeError(f"could not localize language menu for {locale['code']}: {count} matches")

    language_pattern = re.compile(r'    <section id="language">.*?</section>', re.DOTALL)
    text, count = language_pattern.subn(language_section(locale), text, count=1)
    if count != 1:
        raise RuntimeError(
            f"could not localize language section for {locale['code']}: {count} matches"
        )

    text = apply_manifest(text, manifest, str(locale["code"]))
    text = normalize_shared_asset_urls(text, registry)

    for source_path, target in localized_documents(locale).items():
        text = text.replace(
            f'href="{BASE_URL}{source_path}"',
            f'href="{BASE_URL}{target["path"]}"',
        )

    if not bool(locale.get("indexable", True)):
        text = replace_tag_content(
            text,
            r'<meta name="robots" content="[^"]*">',
            '<meta name="robots" content="noindex,follow">',
            "homepage robots",
        )

    return localize_json_ld(text, locale, manifest)


def normalize_shared_asset_urls(text: str, registry: dict[str, object]) -> str:
    assets = registry.get("sharedAssets") or []
    if not isinstance(assets, list):
        raise RuntimeError("locale registry sharedAssets must be an array")
    for asset in assets:
        relative = str(asset)
        absolute = BASE_URL + relative
        text = text.replace(f'src="{relative}"', f'src="{absolute}"')
        text = text.replace(f'href="{relative}"', f'href="{absolute}"')
    return text


def project_route_key(source_path: str, target: dict[str, str]) -> str | None:
    explicit = target.get("projectKey")
    if explicit:
        return explicit
    known = {
        "status/": "statusHtml",
        "how-it-works/": "howItWorksHtml",
    }
    return known.get(source_path)


def update_project_locale_routes(
    site_root: Path,
    registry: dict[str, object],
    *,
    verify_only: bool = False,
) -> None:
    project_path = site_root / "project.json"
    if not project_path.is_file():
        raise RuntimeError("built site is missing project.json for locale route maintenance")
    project = json.loads(project_path.read_text(encoding="utf-8"))
    localized = project.setdefault("localizedDocumentation", {})
    if not isinstance(localized, dict):
        raise RuntimeError("project.json localizedDocumentation must be an object")

    default_code = str(registry["defaultLocale"])
    changed = False
    for locale in locales(registry, published_only=True):
        code = str(locale["code"])
        if code == default_code:
            continue
        entry = localized.setdefault(code, {})
        if not isinstance(entry, dict):
            raise RuntimeError(f"project.json localizedDocumentation.{code} must be an object")
        expected: dict[str, str] = {"homeHtml": locale_url(locale)}
        for source_path, target in localized_documents(locale).items():
            key = project_route_key(source_path, target)
            if key:
                expected[key] = BASE_URL + target["path"]
        for key, value in expected.items():
            if entry.get(key) == value:
                continue
            if verify_only:
                raise RuntimeError(
                    f"project.json localizedDocumentation.{code}.{key} is stale: "
                    f"expected {value!r}, got {entry.get(key)!r}"
                )
            entry[key] = value
            changed = True

    if changed and not verify_only:
        project_path.write_text(
            json.dumps(project, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )


def element_ids(text: str) -> list[str]:
    return re.findall(r'\bid="([^"]+)"', text)


def html_has_bad_github_blob_image(text: str) -> str | None:
    for src in re.findall(r'<img[^>]+src="([^"]+)"', text):
        parsed = urlparse(src)
        if parsed.scheme in {"http", "https"} and parsed.hostname == "github.com" and "/blob/" in parsed.path:
            return src
    return None


def verify_homepages(
    site_root: Path,
    pages: dict[str, str],
    registry: dict[str, object],
    manifests: dict[str, dict[str, object]],
) -> None:
    default_code = str(registry["defaultLocale"])
    default_locale = locale_by_code(registry, default_code)
    english = pages[default_code]
    if f'<html lang="{default_locale["htmlLang"]}">' not in english:
        raise RuntimeError("default homepage lang attribute is incorrect")
    if f'<link rel="canonical" href="{locale_url(default_locale)}">' not in english:
        raise RuntimeError("default homepage canonical is incorrect")

    published = locales(registry, published_only=True)
    indexable = [locale for locale in published if bool(locale.get("indexable", True))]
    expected_alternates = [
        (str(locale["hreflang"]), locale_url(locale)) for locale in indexable
    ] + [("x-default", locale_url(default_locale))]

    english_ids = element_ids(english)
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

    for locale in published:
        code = str(locale["code"])
        page = pages.get(code)
        if page is None:
            raise RuntimeError(f"built site is missing published locale homepage: {code}")
        html_lang = html.escape(str(locale["htmlLang"]), quote=True)
        direction = str(locale.get("direction") or "ltr")
        expected_html = f'<html lang="{html_lang}"'
        if expected_html not in page:
            raise RuntimeError(f"homepage lang attribute is incorrect for {code}")
        if direction == "rtl" and f'<html lang="{html_lang}" dir="rtl">' not in page:
            raise RuntimeError(f"homepage rtl direction is missing for {code}")
        if f'<link rel="canonical" href="{locale_url(locale)}">' not in page:
            raise RuntimeError(f"homepage canonical is incorrect for {code}")

        for hreflang, url in expected_alternates:
            needle = f'hreflang="{hreflang}" href="{url}"'
            if needle not in page:
                raise RuntimeError(f"homepage hreflang reciprocity missing for {code}: {needle}")

        if element_ids(page) != english_ids:
            raise RuntimeError(f"localized homepage DOM identity sequence drifted from English: {code}")
        bad_src = html_has_bad_github_blob_image(page)
        if bad_src:
            raise RuntimeError(f"{code} homepage contains a non-image GitHub blob URL: {bad_src}")
        if BASE_URL + DEPLOYED_CAPTURE.as_posix() not in page:
            raise RuntimeError(f"{code} homepage does not use the deployed development capture")

        for offered in published:
            offered_label = html.escape(str(offered["label"]))
            if offered_label not in page or locale_url(offered) not in page:
                raise RuntimeError(
                    f"{code} homepage language menu is missing published locale {offered['code']}"
                )

        if code == default_code:
            continue
        manifest = manifests[code]
        for source_path, target in localized_documents(locale).items():
            if f'href="{BASE_URL}{target["path"]}"' not in page:
                raise RuntimeError(
                    f"{code} homepage does not link to localized document {source_path}"
                )
        for marker in locale.get("forbiddenMarkers") or []:
            if str(marker) in page:
                raise RuntimeError(f"{code} homepage contains forbidden marker: {marker!r}")

        validation = locale.get("translationValidation") or {}
        if not isinstance(validation, dict):
            raise RuntimeError(f"{code} translationValidation must be an object")
        minimum = int(validation.get("minimumCharacters") or 0)
        pattern = str(validation.get("characterPattern") or "")
        if minimum:
            if not pattern:
                raise RuntimeError(f"{code} locale registry entry needs a characterPattern")
            locale_count = len(re.findall(pattern, page))
            if locale_count < minimum:
                raise RuntimeError(
                    f"{code} homepage translation is unexpectedly sparse: {locale_count} < {minimum}"
                )
        for phrase in manifest.get("forbiddenEnglish") or []:
            if str(phrase) in page:
                raise RuntimeError(
                    f"{code} homepage still contains untranslated core copy: {phrase!r}"
                )
        if not bool(locale.get("indexable", True)) and 'content="noindex,follow"' not in page:
            raise RuntimeError(f"preview locale {code} must be noindex")

    capture = site_root / DEPLOYED_CAPTURE
    if not capture.is_file() or capture.stat().st_size == 0:
        raise RuntimeError("deployed homepage capture is missing/empty")


def build_homepage_locales(repo_root: Path, site_root: Path, *, verify_only: bool = False) -> None:
    repo_root = repo_root.resolve()
    site_root = site_root.resolve()
    registry = load_registry(repo_root)
    default_code = str(registry["defaultLocale"])

    manifests: dict[str, dict[str, object]] = {}
    for locale in locales(registry, published_only=True):
        code = str(locale["code"])
        if code != default_code:
            manifests[code] = load_manifest(repo_root, locale)

    english_path = site_root / "index.html"
    if not english_path.is_file():
        raise RuntimeError("built site is missing finalized English homepage")

    output_paths = {
        str(locale["code"]): site_root / str(locale.get("path") or "") / "index.html"
        for locale in locales(registry, published_only=True)
    }
    output_paths[default_code] = english_path

    if verify_only:
        pages: dict[str, str] = {}
        for code, path in output_paths.items():
            if not path.is_file():
                raise RuntimeError(f"built site is missing locale homepage: {code} ({path})")
            pages[code] = path.read_text(encoding="utf-8")
        verify_homepages(site_root, pages, registry, manifests)
        update_project_locale_routes(site_root, registry, verify_only=True)
        return

    english = normalize_english_homepage(
        repo_root,
        site_root,
        english_path.read_text(encoding="utf-8"),
        registry,
    )
    pages = {default_code: english}
    for locale in locales(registry, published_only=True):
        code = str(locale["code"])
        if code == default_code:
            continue
        pages[code] = build_localized_homepage(english, locale, manifests[code], registry)

    verify_homepages(site_root, pages, registry, manifests)

    english_path.write_text(english, encoding="utf-8")
    for code, page in pages.items():
        if code == default_code:
            continue
        output = output_paths[code]
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(page, encoding="utf-8")

    update_project_locale_routes(site_root, registry)


def main() -> None:
    args = parse_args()
    build_homepage_locales(args.repo_root, args.site_root, verify_only=args.verify_only)


if __name__ == "__main__":
    main()
