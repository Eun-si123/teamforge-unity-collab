#!/usr/bin/env python3
"""Render crawlable TeamForge documentation from the shared locale registry."""

from __future__ import annotations

import argparse
import html
import json
import re
import subprocess
from pathlib import Path

from build_homepage_locales import (
    BASE_URL,
    REPOSITORY_URL,
    load_registry,
    locale_by_code,
    locale_ui_script,
    localize_content_links,
    locales,
    translation_notice,
)
from doc_markdown import render_markdown

PAGES = (
    {
        "slug": "docs", "source": "docs-index.txt", "repo_source": "site/docs-hub.json",
        "project_key": "docsHubHtml", "nav_label": "Docs", "title": "TeamForge Documentation — Find Your Next Step",
        "heading": "Documentation", "description": "Understand the workflow, check current boundaries, build from source or contribute to TeamForge. Start with the guide that answers your question.",
    },
    {
        "slug": "compatibility", "source": "compatibility.txt", "repo_source": "docs/compatibility.md",
        "project_key": "compatibilityHtml", "nav_label": "Compatibility", "title": "TeamForge Compatibility & Requirements",
        "heading": "Compatibility & requirements", "description": "Platform, Unity and network requirements, source-versus-package boundaries, and minimum requirements not yet established through controlled testing.",
    },
    {
        "slug": "contributing", "source": "contributing.txt", "repo_source": ".github/CONTRIBUTING.md",
        "project_key": "contributingHtml", "nav_label": "Contributing", "title": "Contribute to TeamForge",
        "heading": "Contributing", "description": "Help with Unity review, networking, failure-case testing, documentation and the contributor workflow.",
    },
    {
        "slug": "about", "source": "about.txt", "repo_source": "site/about.md",
        "project_key": "aboutHtml", "nav_label": "About", "title": "About TeamForge — Why It Exists",
        "heading": "An experiment in working together.", "description": "Why TeamForge explores the live working space between source-control commits, and how to help shape the project.",
    },
    {
        "slug": "status",
        "source": "status.txt",
        "repo_source": "docs/STATUS.md",
        "project_key": "statusHtml",
        "nav_label": "Status",
        "title": "TeamForge Status — Implementation, Validation & Release Readiness",
        "heading": "Current status",
        "description": "Current TeamForge implementation, validation, limitations, source-versus-package boundaries, blockers, and release-readiness status for the Unity Editor collaboration project.",
    },
    {
        "slug": "how-it-works",
        "source": "how-it-works.txt",
        "repo_source": "docs/HOW_IT_WORKS.md",
        "project_key": "howItWorksHtml",
        "nav_label": "How it works",
        "title": "How TeamForge Works — Host, Guest, P2P Transfer & Realtime Authority",
        "heading": "How TeamForge works",
        "description": "A guided end-to-end explanation of TeamForge hosting, joining, direct project transfer, realtime authority, locking, reconnect, and recovery.",
    },
    {
        "slug": "architecture",
        "source": "architecture-overview.txt",
        "repo_source": "docs/architecture.md",
        "project_key": "architectureHtml",
        "nav_label": "Architecture",
        "title": "TeamForge Architecture — Unity Real-time Collaboration Design",
        "heading": "Architecture",
        "description": "As-built TeamForge architecture covering Unity Editor collaboration, realtime authority, P2P project transfer, trust boundaries, and module responsibilities.",
    },
    {
        "slug": "source",
        "source": "source.txt",
        "repo_source": "docs/SOURCE.md",
        "project_key": "sourceGuideHtml",
        "nav_label": "Source",
        "title": "TeamForge Source Guide — Checkout, Build & Validation",
        "heading": "Source workflow",
        "description": "Source checkout, build, fresh-clone validation, Launcher and Unity test entry points, and contributor verification workflow for TeamForge.",
    },
    {
        "slug": "test-lab",
        "source": "test-lab.txt",
        "repo_source": "docs/TEST_LAB.md",
        "project_key": "testLabHtml",
        "nav_label": "Test Lab",
        "title": "TeamForge Test Lab — Named Validation Scenarios & Evidence Boundaries",
        "heading": "Test Lab",
        "description": "Named TeamForge validation scenarios, local versus external evidence lanes, PASS/FAIL/INCOMPLETE semantics, and bounded failure-log behavior.",
    },
    {
        "slug": "engineering",
        "source": "engineering-guide.txt",
        "repo_source": "docs/ENGINEERING_GUIDE.md",
        "project_key": "engineeringGuideHtml",
        "nav_label": "Engineering",
        "title": "TeamForge Engineering Guide — Change Planning, Risk & Evidence",
        "heading": "Engineering guide",
        "description": "TeamForge engineering change planning: scope, risk, invariants, failure modes, validation lanes, evidence, and release impact.",
    },
    {
        "slug": "documentation",
        "source": "documentation-guide.txt",
        "repo_source": "docs/DOCUMENTATION_GUIDE.md",
        "project_key": "documentationGuideHtml",
        "nav_label": "Docs",
        "title": "TeamForge Documentation Guide — Ownership, Routing & Drift Prevention",
        "heading": "Documentation maintenance",
        "description": "TeamForge documentation ownership, planning, propagation, historical handling, and automated drift-prevention rules.",
    },
    {
        "slug": "changelog",
        "source": "changelog.txt",
        "repo_source": "CHANGELOG.md",
        "project_key": "changelogHtml",
        "nav_label": "Changelog",
        "title": "TeamForge Changelog — Unity Collaboration Product Changes",
        "heading": "Product changelog",
        "description": "TeamForge product-version changes with links to detailed package and engineering history.",
    },
    {
        "slug": "security",
        "source": "security.txt",
        "repo_source": ".github/SECURITY.md",
        "project_key": "securityHtml",
        "nav_label": "Security",
        "title": "TeamForge Security — Scope, Trust Boundaries & Reporting",
        "heading": "Security",
        "description": "TeamForge security scope, trust assumptions, current limitations, reporting guidance, and safe testing expectations for the experimental Unity collaboration project.",
    },
)



def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("site_root", type=Path)
    return parser.parse_args()


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def route_for(page: dict[str, str]) -> str:
    return page["slug"] + "/"


def locale_documents(locale: dict[str, object]) -> dict[str, dict[str, object]]:
    raw = locale.get("documents", {})
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise RuntimeError(f"locale {locale.get('code')} documents must be an object")
    documents: dict[str, dict[str, object]] = {}
    for route, spec in raw.items():
        if not isinstance(route, str) or not route.endswith("/") or route.startswith("/"):
            raise RuntimeError(f"locale {locale.get('code')} has invalid document route: {route!r}")
        if not isinstance(spec, dict):
            raise RuntimeError(f"locale {locale.get('code')} document {route} must be an object")
        documents[route] = spec
    return documents


def localized_spec(locale: dict[str, object], route: str) -> dict[str, object] | None:
    return locale_documents(locale).get(route)


def document_path(registry: dict[str, object], locale: dict[str, object], route: str) -> str | None:
    if locale.get("code") == registry.get("defaultLocale"):
        return route
    spec = localized_spec(locale, route)
    if spec is None:
        return None
    path = str(spec.get("path") or "")
    if not path or path.startswith("/") or not path.endswith("/"):
        raise RuntimeError(f"locale {locale.get('code')} document {route} has invalid path: {path!r}")
    return path


def document_url(registry: dict[str, object], locale: dict[str, object], route: str) -> str | None:
    path = document_path(registry, locale, route)
    return BASE_URL + path if path is not None else None


def document_variants(
    registry: dict[str, object],
    route: str,
    *,
    indexable_only: bool = False,
) -> list[dict[str, object]]:
    variants: list[dict[str, object]] = []
    for locale in locales(registry, published_only=True):
        if document_path(registry, locale, route) is None:
            continue
        if indexable_only and not bool(locale.get("indexable", True)):
            continue
        variants.append(locale)
    return variants


def git_last_change(repo_source: str) -> str | None:
    root = repo_root()
    if not (root / repo_source).exists():
        return None
    proc = subprocess.run(
        ["git", "log", "-1", "--format=%cs", "--", repo_source],
        cwd=root,
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    value = proc.stdout.strip()
    return value or None


def translation_state(source_repo: str, localized_repo: str) -> tuple[str, str | None, str | None]:
    source_date = git_last_change(source_repo)
    localized_date = git_last_change(localized_repo)
    if not source_date or not localized_date:
        return "unknown", source_date, localized_date
    if localized_date < source_date:
        return "stale", source_date, localized_date
    return "current", source_date, localized_date


def alternate_links(registry: dict[str, object], route: str) -> str:
    variants = document_variants(registry, route, indexable_only=True)
    if len(variants) <= 1:
        return ""
    default_locale = locale_by_code(registry, str(registry["defaultLocale"]))
    default_url = document_url(registry, default_locale, route)
    if default_url is None:
        raise RuntimeError(f"default document URL missing for {route}")
    lines: list[str] = []
    for locale in variants:
        url = document_url(registry, locale, route)
        if url is None:
            continue
        lines.append(
            f'  <link rel="alternate" hreflang="{html.escape(str(locale["hreflang"]), quote=True)}" '
            f'href="{html.escape(url, quote=True)}">'
        )
    lines.append(f'  <link rel="alternate" hreflang="x-default" href="{html.escape(default_url, quote=True)}">')
    return "\n".join(lines)


def language_nav(registry: dict[str, object], route: str, active: dict[str, object]) -> str:
    aria = html.escape(str(active.get("menuAriaLabel") or "Choose language"), quote=True)
    group = html.escape(str(active.get("menuGroupLabel") or "Languages"), quote=True)
    if len(document_variants(registry, route)) == 1:
        return '<span class="locale-current" lang="en">English</span>'
    active_code = str(active["code"])
    active_label = html.escape(str(active["label"]))
    ui = active.get("documentUi") if isinstance(active.get("documentUi"), dict) else {}
    untranslated_template = str(
        ui.get("untranslatedHomeTitle") or "{label} homepage; this document is not translated yet"
    )
    items: list[str] = []
    for locale in locales(registry, published_only=True):
        code = str(locale["code"])
        label = html.escape(str(locale["label"]))
        html_lang = html.escape(str(locale["htmlLang"]), quote=True)
        hreflang = html.escape(str(locale["hreflang"]), quote=True)
        if code == active_code:
            items.append(
                f'<strong lang="{html_lang}" dir="auto" translate="no">{label}</strong>'
            )
            continue
        target = document_url(registry, locale, route)
        title = ""
        if target is None:
            continue
        items.append(
            f'<a href="{html.escape(target, quote=True)}" lang="{html_lang}" dir="auto" '
            f'hreflang="{hreflang}" translate="no"{title}>{label}</a>'
        )
    return (
        f'<details class="locale-menu"><summary aria-label="{aria}" dir="auto">🌐 {active_label}</summary>'
        f'<div class="locale-menu-popover" role="group" aria-label="{group}">'
        + "".join(items)
        + "</div></details>"
    )


def ui_label(active: dict[str, object], label: str) -> str:
    return str((active.get("documentUi", {}).get("labels", {})).get(label, label))


def nav_items(registry: dict[str, object], active: dict[str, object]) -> str:
    links = []
    for slug in ("how-it-works", "status", "docs"):
        page = next(page for page in PAGES if page["slug"] == slug)
        spec = localized_spec(active, route_for(page))
        path = str(spec["path"]) if spec else route_for(page)
        label = str(spec.get("navLabel")) if spec else ui_label(active, page["nav_label"])
        if not spec and active["code"] != registry["defaultLocale"]:
            label += " (" + str(active.get("documentUi", {}).get("englishLabel", "English")) + ")"
        links.append(f'<a href="{BASE_URL}{path}">{html.escape(label)}</a>')
    label = str(active.get("documentUi", {}).get("exploreLabel", "Explore"))
    return '<details class="site-menu" open><summary>' + html.escape(label) + '</summary><div class="site-menu-links">' + ''.join(links) + '</div></details>'


def footer_links(registry: dict[str, object], active: dict[str, object]) -> str:
    links = []
    for path, label in (("docs/", "Docs"), (REPOSITORY_URL + "/blob/main/docs/SITE_LOCALIZATION.md", "Localization policy"), ("about/", "About / origin"), ("changelog/", "Changelog"), ("contributing/", "Contributing guide →"), ("security/", "Security"), ("llms.txt", "llms.txt")):
        links.append('<a href="' + (path if path.startswith("https://") else BASE_URL + path) + '">' + html.escape(ui_label(active, label)) + '</a>')
    return localize_content_links(''.join(links), registry, active)


def localized_metadata(page: dict[str, str], locale: dict[str, object], route: str) -> dict[str, str]:
    spec = localized_spec(locale, route)
    if spec is None:
        return {
            "source": page["source"],
            "repo_source": page["repo_source"],
            "source_repo_source": page["repo_source"],
            "title": page["title"],
            "heading": page["heading"],
            "description": page["description"],
        }
    required = ("source", "repoSource", "sourceRepoSource", "title", "heading", "description")
    missing = [key for key in required if not spec.get(key)]
    if missing:
        raise RuntimeError(f"locale {locale.get('code')} document {route} is missing {missing}")
    return {
        "source": str(spec["source"]),
        "repo_source": str(spec["repoSource"]),
        "source_repo_source": str(spec["sourceRepoSource"]),
        "title": str(spec["title"]),
        "heading": str(spec["heading"]),
        "description": str(spec["description"]),
    }


def stale_notice(
    registry: dict[str, object],
    locale: dict[str, object],
    route: str,
    metadata: dict[str, str],
) -> str:
    if locale.get("code") == registry.get("defaultLocale"):
        return ""
    state, source_date, localized_date = translation_state(
        metadata["source_repo_source"], metadata["repo_source"]
    )
    if state != "stale":
        return ""
    ui = locale.get("documentUi") if isinstance(locale.get("documentUi"), dict) else {}
    default_locale = locale_by_code(registry, str(registry["defaultLocale"]))
    source_url = document_url(registry, default_locale, route) or BASE_URL + route
    link_label = html.escape(str(ui.get("sourceLinkLabel") or "latest source document"))
    source_link = f'<a href="{html.escape(source_url, quote=True)}">{link_label}</a>'
    template = str(
        ui.get("staleTemplate")
        or "This translation ({localizedDate}) is older than the source document ({sourceDate}). Check {sourceLink}."
    )
    message = template.format(
        localizedDate=html.escape(localized_date or "unknown"),
        sourceDate=html.escape(source_date or "unknown"),
        sourceLink=source_link,
    )
    title = html.escape(str(ui.get("staleTitle") or "Translation freshness notice:"))
    return f'<div class="notice" role="note"><strong>{title}</strong> {message}</div>'


def build_docs_hub(data: dict[str, object]) -> str:
    def link(item: dict[str, str], card: bool = False) -> str:
        path = str(item["href"])
        href = path if path.startswith("https://") else BASE_URL + path
        label = html.escape(str(item["label"]))
        body = ("<strong>" + label + " →</strong><span>" + html.escape(str(item["description"])) + "</span>") if card else label
        return '<a href="' + html.escape(href, quote=True) + '">' + body + '</a>'
    cards = ''.join('<h2 id="hub-' + str(i) + '">' + html.escape(group["heading"]) + '</h2><div class="hub-links">' + ''.join(link(item, True) for item in group["links"]) + '</div>' for i, group in enumerate(data["groups"]))
    sections = ''.join('<h2 id="' + html.escape(section["id"], quote=True) + '">' + html.escape(section["heading"]) + '</h2>' + ''.join('<p>' + ' · '.join(link(item) for item in paragraph) + '</p>' for paragraph in section["paragraphs"]) for section in data["sections"])
    return cards + str(data.get("languageShortcut", "")) + sections


def build_page(
    page: dict[str, str],
    markdown: str,
    project: dict[str, object],
    registry: dict[str, object],
    locale: dict[str, object],
) -> str:
    route = route_for(page)
    metadata = localized_metadata(page, locale, route)
    canonical = document_url(registry, locale, route)
    if canonical is None:
        raise RuntimeError(f"cannot build untranslated route {route} for locale {locale.get('code')}")

    ui = locale.get("documentUi") if isinstance(locale.get("documentUi"), dict) else {}
    raw_url = BASE_URL + metadata["source"]
    source_url = f"{REPOSITORY_URL}/blob/main/{metadata['repo_source']}"
    version = str(project.get("version") or "")
    status_label = str(project.get("statusLabel") or "Early Public Preview")
    eyebrow = str(ui.get("eyebrowTemplate") or "TeamForge {version} · {statusLabel}").format(
        version=version,
        statusLabel=status_label,
    )
    source_label = str(ui.get("sourceLabel") or "Canonical source")
    mirror_label = str(ui.get("mirrorLabel") or "plain-text mirror")
    source_note = str(ui.get("sourceNote") or "Generated from maintained repository documentation.")
    footer = str(ui.get("footer") or "TeamForge documentation.")
    nav_label = str(ui.get("navAriaLabel") or "Documentation navigation")
    robots = "index,follow,max-image-preview:large" if bool(locale.get("indexable", True)) else "noindex,follow"
    html_lang = str(locale["htmlLang"])
    direction = str(locale.get("direction") or "ltr")
    dir_attr = ' dir="rtl"' if direction == "rtl" else ""
    alternates = alternate_links(registry, route)
    article = build_docs_hub(json.loads(markdown)) if page["slug"] == "docs" else render_markdown(markdown, metadata["repo_source"])
    # The page header already owns the document title; retain its fragment target.
    article = re.sub(r'<h1 id="([^"]+)">.*?</h1>', r'<span id="\1"></span>', article, count=1)
    article = article.replace("<h1 ", "<h2 ").replace("</h1>", "</h2>")
    # An explicit English language link must not be rewritten to the active locale.
    for target_page in PAGES:
        article = article.replace(
            f'<a href="{REPOSITORY_URL}/blob/main/{target_page["repo_source"]}">English</a>',
            f'<a href="{BASE_URL}{route_for(target_page)}">English</a>',
        )
    for target_page in PAGES:
        target_route = route_for(target_page)
        target_path = document_path(registry, locale, target_route) or target_route
        article = article.replace(f'{REPOSITORY_URL}/blob/main/{target_page["repo_source"]}', BASE_URL + target_path)
    # Language links inside maintained Markdown also point to equivalent rendered pages.
    for target_page in PAGES:
        if target_page["slug"] == "docs":
            continue
        for variant in document_variants(registry, route_for(target_page)):
            variant_metadata = localized_metadata(target_page, variant, route_for(target_page))
            article = article.replace(f'{REPOSITORY_URL}/blob/main/{variant_metadata["repo_source"]}', document_url(registry, variant, route_for(target_page)))
    article = localize_content_links(article, registry, locale)
    headings = re.findall(r'<h2 id="([^"]+)">(.*?)</h2>', article)
    toc_title = str(ui.get("tocLabel") or "On this page")
    toc = '<details class="doc-toc" open><summary>' + html.escape(toc_title) + '</summary><div>' + ''.join(
        f'<a href="#{anchor}">{label}</a>' for anchor, label in headings
    ) + '</div></details>' if headings else ''
    notice = stale_notice(registry, locale, route, metadata)

    json_ld = json.dumps(
        {
            "@context": "https://schema.org",
            "@type": "TechArticle",
            "headline": metadata["title"],
            "description": metadata["description"],
            "url": canonical,
            "mainEntityOfPage": canonical,
            "inLanguage": html_lang,
            "isPartOf": {"@type": "WebSite", "name": "TeamForge", "url": BASE_URL},
            "about": {
                "@type": "SoftwareSourceCode",
                "name": "TeamForge",
                "codeRepository": REPOSITORY_URL,
            },
            "author": {
                "@type": "Person",
                "name": str(project.get("maintainer") or "Eun-si123 / BlackProtogen"),
            },
            "isAccessibleForFree": True,
        },
        ensure_ascii=False,
        indent=2,
    )

    return f'''<!doctype html>
<html lang="{html.escape(html_lang, quote=True)}"{dir_attr}>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html.escape(metadata["title"])}</title>
  <meta name="description" content="{html.escape(metadata["description"], quote=True)}">
  <meta name="robots" content="{robots}">
  <link rel="canonical" href="{html.escape(canonical, quote=True)}">
{alternates}
  <link rel="alternate" type="text/plain" href="{html.escape(raw_url, quote=True)}" title="Plain-text source mirror">
  <script src="{BASE_URL}theme-toggle.js"></script>
  <link rel="stylesheet" href="{BASE_URL}site-theme.css">
  <meta property="og:type" content="article">
  <meta property="og:title" content="{html.escape(metadata["title"], quote=True)}">
  <meta property="og:description" content="{html.escape(metadata["description"], quote=True)}">
  <meta property="og:url" content="{html.escape(canonical, quote=True)}">
  <script type="application/ld+json">
{json_ld}
  </script>
  <script type="module" src="{BASE_URL}locale-picker.js"></script>
  <script src="{BASE_URL}site-navigation.js" defer></script>
  <script type="module" src="{BASE_URL}doc-diagrams.js"></script>
{locale_ui_script(locale)}
</head>
<body>
<a class="skip-link" href="#main">{html.escape(str(ui.get("skipLabel") or "Skip to content"))}</a>
<nav class="site-nav" aria-label="{html.escape(nav_label, quote=True)}"><div class="wrap nav-inner">
  <a class="brand" href="{BASE_URL + str(locale.get('path') or '')}">TeamForge</a><div class="nav-links">{nav_items(registry, locale)}
  {language_nav(registry, route, locale)}
  <a class="github-link" href="{REPOSITORY_URL}">GitHub ↗</a>
</div></div></nav>
<header class="doc-header">
  <div class="eyebrow">{html.escape(eyebrow)}</div>
  <h1>{html.escape(metadata["heading"])}</h1>
  <p class="lead">{html.escape(metadata["description"])}</p>
  {notice}
  <details class="meta"><summary>{html.escape(source_label)}</summary> <a href="{source_url}">{html.escape(metadata["repo_source"])}</a> · <a href="{raw_url}">{html.escape(mirror_label)}</a><br>
  <p>{html.escape(source_note)}</p></details>
</header>
<main id="main" class="doc-main">
  <article class="doc-content">
{article}
  </article>
  {toc}
</main>
<footer class="doc-footer"><p>{html.escape(footer)}</p>{translation_notice(locale)}<div class="footer-links">{footer_links(registry, locale)}</div></footer>
</body>
</html>
'''


def add_routes(project: dict[str, object], registry: dict[str, object]) -> None:
    documentation = project.setdefault("documentation", {})
    if not isinstance(documentation, dict):
        raise RuntimeError("project.json documentation must be an object")
    for page in PAGES:
        documentation[page["project_key"]] = BASE_URL + route_for(page)

    localized = project.setdefault("localizedDocumentation", {})
    if not isinstance(localized, dict):
        raise RuntimeError("project.json localizedDocumentation must be an object")

    default_code = str(registry["defaultLocale"])
    for locale in locales(registry, published_only=True):
        code = str(locale["code"])
        if code == default_code:
            continue
        entry = localized.setdefault(code, {})
        if not isinstance(entry, dict):
            raise RuntimeError(f"project.json localizedDocumentation.{code} must be an object")
        entry["homeHtml"] = BASE_URL + str(locale.get("path") or "")
        for page in PAGES:
            target = document_url(registry, locale, route_for(page))
            if target is not None:
                entry[page["project_key"]] = target


def verify_outputs(site_root: Path, registry: dict[str, object]) -> None:
    default_locale = locale_by_code(registry, str(registry["defaultLocale"]))
    picker_script = f'<script type="module" src="{BASE_URL}locale-picker.js"></script>'
    for page in PAGES:
        route = route_for(page)
        default_path = site_root / route / "index.html"
        if not default_path.is_file():
            raise RuntimeError(f"default documentation page is missing: {route}")
        default_text = default_path.read_text(encoding="utf-8")
        if f'<html lang="{default_locale["htmlLang"]}"' not in default_text:
            raise RuntimeError(f"default documentation language metadata is wrong: {route}")

        variants = document_variants(registry, route)
        for locale in variants:
            path = document_path(registry, locale, route)
            if path is None:
                continue
            target = site_root / path / "index.html"
            if not target.is_file():
                raise RuntimeError(f"localized document is missing: {locale['code']} {route}")
            text = target.read_text(encoding="utf-8")
            expected_lang = str(locale["htmlLang"])
            if f'<html lang="{expected_lang}"' not in text:
                raise RuntimeError(f"localized document language metadata is wrong: {locale['code']} {route}")
            canonical = BASE_URL + path
            if f'<link rel="canonical" href="{canonical}">' not in text:
                raise RuntimeError(f"localized document canonical is wrong: {locale['code']} {route}")
            if len(variants) > 1:
                if '<details class="locale-menu">' not in text or picker_script not in text:
                    raise RuntimeError(f"localized document searchable language picker missing: {locale['code']} {route}")
            elif '<span class="locale-current" lang="en">English</span>' not in text:
                raise RuntimeError(f"single-language document marker missing: {route}")

        indexable_variants = document_variants(registry, route, indexable_only=True)
        if len(indexable_variants) > 1:
            expected = []
            for locale in indexable_variants:
                url = document_url(registry, locale, route)
                if url is not None:
                    expected.append(f'hreflang="{locale["hreflang"]}" href="{url}"')
            default_url = document_url(registry, default_locale, route)
            expected.append(f'hreflang="x-default" href="{default_url}"')
            for locale in variants:
                path = document_path(registry, locale, route)
                if path is None:
                    continue
                text = (site_root / path / "index.html").read_text(encoding="utf-8")
                for needle in expected:
                    if needle not in text:
                        raise RuntimeError(
                            f"document hreflang reciprocity missing for {locale['code']} {route}: {needle}"
                        )


def render_doc_pages(site_root: Path, project: dict[str, object]) -> None:
    for source, output in (("site/docs-hub.json", "docs-index.txt"), ("site/about.md", "about.txt"), ("docs/compatibility.md", "compatibility.txt")):
        (site_root / output).write_text((repo_root() / source).read_text(encoding="utf-8"), encoding="utf-8")
    registry = load_registry(repo_root())
    # Registry-owned mirrors are generated from their maintained source every build.
    for locale in locales(registry, published_only=True):
        for spec in locale_documents(locale).values():
            destination = site_root / str(spec["source"])
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text((repo_root() / str(spec["repoSource"])).read_text(encoding="utf-8"), encoding="utf-8")
    add_routes(project, registry)

    default_locale = locale_by_code(registry, str(registry["defaultLocale"]))
    for page in PAGES:
        route = route_for(page)
        source_path = site_root / page["source"]
        if not source_path.is_file():
            raise RuntimeError(f"missing documentation mirror for HTML render: {page['source']}")
        output_dir = site_root / route
        output_dir.mkdir(parents=True, exist_ok=True)
        output = build_page(
            page,
            source_path.read_text(encoding="utf-8"),
            project,
            registry,
            default_locale,
        )
        (output_dir / "index.html").write_text(output, encoding="utf-8")

        for locale in locales(registry, published_only=True):
            if locale.get("code") == registry.get("defaultLocale"):
                continue
            spec = localized_spec(locale, route)
            if spec is None:
                continue
            metadata = localized_metadata(page, locale, route)
            localized_source = site_root / metadata["source"]
            if not localized_source.is_file():
                raise RuntimeError(
                    f"missing localized documentation mirror for {locale['code']} {route}: {metadata['source']}"
                )
            output_path = document_path(registry, locale, route)
            if output_path is None:
                raise RuntimeError(f"localized output path missing for {locale['code']} {route}")
            localized_dir = site_root / output_path
            localized_dir.mkdir(parents=True, exist_ok=True)
            localized_output = build_page(
                page,
                localized_source.read_text(encoding="utf-8"),
                project,
                registry,
                locale,
            )
            (localized_dir / "index.html").write_text(localized_output, encoding="utf-8")

    verify_outputs(site_root, registry)


def main() -> None:
    args = parse_args()
    site_root = args.site_root.resolve()
    project_path = site_root / "project.json"
    if not project_path.is_file():
        raise SystemExit("built site is missing project.json")
    project = json.loads(project_path.read_text(encoding="utf-8"))
    render_doc_pages(site_root, project)
    project_path.write_text(
        json.dumps(project, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
