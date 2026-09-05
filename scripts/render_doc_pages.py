#!/usr/bin/env python3
"""Render crawlable TeamForge documentation from the shared locale registry."""

from __future__ import annotations

import argparse
import html
import json
import subprocess
from pathlib import Path

from build_homepage_locales import (
    BASE_URL,
    REPOSITORY_URL,
    load_registry,
    locale_by_code,
    locales,
)
from doc_markdown import render_markdown

PAGES = (
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

DOC_STYLE = """
:root{color-scheme:dark;--bg:#1b1d21;--panel:#24272c;--text:#f1f2f4;--muted:#a6abb3;--quiet:#858b94;--line:#3a3e45;--line-strong:#4a4f58;--accent:#6db7ff;--accent-soft:#9bd0ff;--warn:#e6b86f;--max:1180px;--reading:900px;--mono:\"SFMono-Regular\",Consolas,\"Liberation Mono\",monospace}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:72px}body{margin:0;min-height:100vh;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;color:var(--text);background:var(--bg);line-height:1.7;-webkit-font-smoothing:antialiased}a{color:var(--accent-soft);text-underline-offset:.18em}:focus-visible{outline:2px solid var(--accent);outline-offset:3px}nav{position:sticky;top:0;z-index:20;border-bottom:1px solid var(--line);background:rgba(27,29,33,.96);backdrop-filter:blur(12px)}.nav{width:min(calc(100% - 2.5rem),var(--max));margin:auto;min-height:64px;display:flex;align-items:center;gap:1rem;flex-wrap:wrap}.brand{display:inline-flex;align-items:center;gap:.72rem;margin-right:auto;color:var(--text);font-weight:720;letter-spacing:-.025em;text-decoration:none}.brand::before{content:\"\";width:22px;height:22px;border:1px solid #79808a;box-shadow:8px 10px 0 -7px var(--accent)}.nav>a:not(.brand){color:var(--muted);text-decoration:none;font-size:.82rem}.nav>a:not(.brand):hover{color:#fff}.locale-menu{position:relative;margin-left:auto;font-size:.78rem;color:var(--quiet);white-space:nowrap}.locale-menu summary{list-style:none;cursor:pointer;color:var(--muted);user-select:none}.locale-menu summary::-webkit-details-marker{display:none}.locale-menu summary::after{content:\"▾\";margin-left:.38rem;color:var(--quiet);font-size:.72em}.locale-menu[open] summary,.locale-menu summary:hover{color:#fff}.locale-menu-popover{position:absolute;right:0;top:calc(100% + .7rem);min-width:170px;padding:.42rem;border:1px solid var(--line-strong);background:#202328;box-shadow:0 18px 46px rgba(0,0,0,.3);z-index:80}.locale-menu-popover a,.locale-menu-popover strong{display:block;padding:.48rem .58rem;border-radius:2px;text-decoration:none;font-size:.82rem;font-weight:560}.locale-menu-popover a{color:#cfd3d8}.locale-menu-popover a:hover{background:#2a2d32;color:#fff}.locale-menu-popover strong{color:#fff;background:#2a2d32}header,main,footer{width:min(calc(100% - 2.5rem),var(--max));margin:auto}header{padding:clamp(4rem,7vw,6.4rem) 0 clamp(2.3rem,4vw,3.5rem);border-bottom:1px solid var(--line-strong)}.eyebrow{color:var(--quiet);font:600 .68rem var(--mono);letter-spacing:.07em;text-transform:uppercase}h1{max-width:14ch;margin:.85rem 0 1.15rem;font-size:clamp(3rem,7vw,6.3rem);line-height:.94;letter-spacing:-.055em;font-weight:760;text-wrap:balance}.lead{max-width:800px;margin:0;color:var(--muted);font-size:clamp(1rem,1.4vw,1.12rem);line-height:1.72}.meta{max-width:920px;margin-top:1.8rem;padding:.9rem 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);color:var(--quiet);font:.72rem/1.65 var(--mono)}.meta strong{color:#d9dde2;font-weight:600}.notice{max-width:920px;margin:1rem 0 0;padding:.8rem 1rem;border-left:2px solid var(--warn);background:#211f1a;color:#d4c6a7;font-size:.84rem}.doc-content{width:min(100%,var(--reading));padding:clamp(2.4rem,5vw,4.3rem) 0 clamp(4rem,7vw,6rem)}.doc-content>h1:first-child{display:none}.doc-content h1{margin:3rem 0 1rem;font-size:clamp(2rem,4vw,3rem);line-height:1.03;letter-spacing:-.04em}.doc-content h2{margin:3.25rem 0 1rem;padding-top:1.1rem;border-top:1px solid var(--line-strong);font-size:clamp(1.55rem,3vw,2.15rem);line-height:1.15;letter-spacing:-.028em}.doc-content h3{margin:2.15rem 0 .7rem;font-size:1.22rem;line-height:1.3}.doc-content p,.doc-content li{color:#cfd3d8}.doc-content p{margin:.75rem 0 1.1rem}.doc-content ul,.doc-content ol{padding-left:1.25rem}.doc-content li+li{margin-top:.35rem}.doc-content strong{color:#f0f1f3}.doc-content code{padding:.1rem .3rem;border:1px solid #393e45;border-radius:2px;background:#191b1f;color:#d8dce1;font-family:var(--mono)}pre{overflow:auto;margin:1.35rem 0;padding:1rem 1.05rem;border:1px solid var(--line-strong);border-radius:2px;background:#15171a;color:#d8dce1}pre code{border:0;padding:0;background:transparent}blockquote{margin:1.5rem 0;padding:.5rem 0 .5rem 1rem;border-left:2px solid var(--warn)}blockquote p{margin:0;color:#cdbf9f!important}.table-wrap{overflow:auto;margin:1.5rem 0;border-top:1px solid var(--line-strong);border-bottom:1px solid var(--line-strong)}table{width:100%;border-collapse:collapse;min-width:560px}th,td{padding:.68rem .72rem;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{color:#e1e4e7;background:#202328;font-size:.78rem}td{color:#c6cbd1;font-size:.86rem}tr:last-child td{border-bottom:0}hr{margin:2.8rem 0;border:0;border-top:1px solid var(--line)}img{max-width:100%;height:auto;border:1px solid var(--line-strong)}footer{padding:2rem 0 4rem;border-top:1px solid var(--line);color:var(--quiet);font-size:.78rem}@media(max-width:900px){.nav{width:min(calc(100% - 1.5rem),var(--max))}.nav>a:not(.brand):nth-of-type(n+5){display:none}header,main,footer{width:min(calc(100% - 1.5rem),var(--max))}}@media(max-width:620px){.nav>a:not(.brand){display:none}.locale-menu{display:block;margin-left:auto}header,main,footer{width:calc(100% - 1rem)}header{padding-top:3.3rem}h1{font-size:clamp(2.8rem,15vw,4.4rem)}.meta{font-size:.66rem;overflow-wrap:anywhere}.table-wrap{margin-inline:-.5rem;padding-inline:.5rem}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
""".strip()


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
            target = BASE_URL + str(locale.get("path") or "")
            title_text = untranslated_template.format(label=str(locale["label"]))
            title = f' title="{html.escape(title_text, quote=True)}"'
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


def nav_items(registry: dict[str, object], active: dict[str, object]) -> str:
    if active.get("code") == registry.get("defaultLocale"):
        return "".join(
            f'<a href="{BASE_URL}{route_for(page)}">{html.escape(page["nav_label"])}</a>'
            for page in PAGES
        )

    documents = locale_documents(active)
    links: list[str] = []
    for page in PAGES:
        route = route_for(page)
        spec = documents.get(route)
        if spec is None:
            continue
        label = html.escape(str(spec.get("navLabel") or spec.get("heading") or page["nav_label"]))
        links.append(f'<a href="{BASE_URL}{html.escape(str(spec["path"]), quote=True)}">{label}</a>')
    default_locale = locale_by_code(registry, str(registry["defaultLocale"]))
    links.append(f'<a href="{BASE_URL}">{html.escape(str(default_locale["label"]))} site</a>')
    return "".join(links)


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
    article = render_markdown(markdown, metadata["repo_source"])
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
  <style>{DOC_STYLE}</style>
</head>
<body>
<nav aria-label="{html.escape(nav_label, quote=True)}"><div class="nav">
  <a class="brand" href="{BASE_URL + str(locale.get('path') or '')}">TeamForge</a>{nav_items(registry, locale)}
  {language_nav(registry, route, locale)}
  <a href="{REPOSITORY_URL}">GitHub ↗</a>
</div></nav>
<header>
  <div class="eyebrow">{html.escape(eyebrow)}</div>
  <h1>{html.escape(metadata["heading"])}</h1>
  <p class="lead">{html.escape(metadata["description"])}</p>
  {notice}
  <div class="meta"><strong>{html.escape(source_label)}</strong> · <a href="{source_url}">{html.escape(metadata["repo_source"])}</a> · <a href="{raw_url}">{html.escape(mirror_label)}</a><br>
  {html.escape(source_note)}</div>
</header>
<main>
  <article class="doc-content">
{article}
  </article>
</main>
<footer>{html.escape(footer)}</footer>
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
            if '<details class="locale-menu">' not in text or picker_script not in text:
                raise RuntimeError(f"localized document searchable language picker missing: {locale['code']} {route}")

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
    registry = load_registry(repo_root())
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
