#!/usr/bin/env python3
"""Enrich the built TeamForge Pages site for search-grounded and direct-fetch clients."""

from __future__ import annotations

import argparse
import html
import json
from pathlib import Path

from build_homepage_locales import build_homepage_locales
from render_doc_pages import render_doc_pages

BASE_URL = "https://eun-si123.github.io/teamforge-unity-collab/"
REPOSITORY_URL = "https://github.com/Eun-si123/teamforge-unity-collab"
SOCIAL_IMAGE_URL = BASE_URL + "assets/teamforge-social-preview.jpg"
SOCIAL_IMAGE_ALT = "TeamForge — open-source real-time collaboration for the Unity Editor"
HEAD_START = "<!-- teamforge-agent-head:start -->"
HEAD_END = "<!-- teamforge-agent-head:end -->"
SECTION_START = "<!-- teamforge-project-facts:start -->"
SECTION_END = "<!-- teamforge-project-facts:end -->"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("site_root", type=Path, help="Built GitHub Pages directory")
    return parser.parse_args()


def remove_marker_block(text: str, start: str, end: str) -> str:
    while start in text and end in text:
        before, remainder = text.split(start, 1)
        _, after = remainder.split(end, 1)
        text = before + after
    return text


def replace_existing_json_ld(text: str) -> str:
    marker = '<script type="application/ld+json">'
    start = text.find(marker)
    if start == -1:
        return text
    end = text.find("</script>", start)
    if end == -1:
        raise RuntimeError("index.html contains an unterminated JSON-LD script")
    return text[:start] + text[end + len("</script>"):]


def improve_homepage_search_copy(text: str) -> str:
    """Keep the slogan while making the primary heading state the page topic plainly."""

    replacements = (
        (
            '<title>TeamForge — Open-source Real-time Collaboration for Unity Editor</title>',
            '<title>TeamForge — Open-source real-time collaboration for the Unity Editor</title>',
        ),
        (
            '<meta property="og:title" content="TeamForge — Real-time Collaboration for Unity Editor">',
            '<meta property="og:title" content="TeamForge — Real-time collaboration for the Unity Editor">',
        ),
        (
            '<meta property="og:image" content="https://raw.githubusercontent.com/Eun-si123/teamforge-unity-collab/main/TeamForge-readme-demo-hq-1280-12fps.gif">',
            (
                f'<meta property="og:image" content="{SOCIAL_IMAGE_URL}">\n'
                '  <meta property="og:image:type" content="image/jpeg">\n'
                '  <meta property="og:image:width" content="640">\n'
                '  <meta property="og:image:height" content="320">\n'
                f'  <meta property="og:image:alt" content="{SOCIAL_IMAGE_ALT}">\n'
                f'  <meta name="twitter:image" content="{SOCIAL_IMAGE_URL}">\n'
                f'  <meta name="twitter:image:alt" content="{SOCIAL_IMAGE_ALT}">'
            ),
        ),
        (
            '<h1><span class="gradient">Build together.</span><br>Stay in sync.</h1>',
            '<h1><span class="gradient">Real-time collaboration</span><br>for the Unity Editor.</h1>',
        ),
    )
    for old, new in replacements:
        count = text.count(old)
        if count != 1:
            raise RuntimeError(f"homepage search-copy anchor changed unexpectedly: {old!r} count={count}")
        text = text.replace(old, new, 1)

    local_doc_links = {
        f'{REPOSITORY_URL}/blob/main/docs/STATUS.md': BASE_URL + "status/",
        f'{REPOSITORY_URL}/blob/main/docs/HOW_IT_WORKS.md': BASE_URL + "how-it-works/",
        f'{REPOSITORY_URL}/blob/main/CHANGELOG.md': BASE_URL + "changelog/",
        f'{REPOSITORY_URL}/blob/main/.github/SECURITY.md': BASE_URL + "security/",
    }
    for old, new in local_doc_links.items():
        if old in text:
            text = text.replace(old, new)

    return text


def project_fact(project: dict[str, object], key: str) -> str:
    value = project.get(key)
    if value is None or value == "":
        raise RuntimeError(f"project.json is missing required field: {key}")
    return str(value)


def build_json_ld(project: dict[str, object]) -> str:
    version = project_fact(project, "version")
    release_id = project_fact(project, "releaseId")
    release_state = project_fact(project, "releaseState")
    work_package = project_fact(project, "workPackage")
    target = project_fact(project, "target")
    generated_at = project_fact(project, "generatedAt")
    source_commit = project_fact(project, "sourceCommit")
    status_label = project_fact(project, "statusLabel")
    runtime_display = project_fact(project, "runtimeDisplay")
    languages = project.get("languages") or ["C#", "JavaScript"]
    license_info = project.get("license") if isinstance(project.get("license"), dict) else {}
    license_url = str(license_info.get("url") or "https://www.gnu.org/licenses/agpl-3.0.html")
    maintainer = project_fact(project, "maintainer")

    payload = {
        "@context": "https://schema.org",
        "@type": "SoftwareSourceCode",
        "@id": BASE_URL + "#teamforge-source",
        "name": "TeamForge",
        "alternateName": "teamforge-unity-collab",
        "description": (
            "Open-source real-time collaboration project for the Unity Editor, "
            "covering live Scene synchronization, presence, same-Scene Hierarchy "
            "collaboration, locking and ownership, and direct P2P project bootstrap."
        ),
        "url": BASE_URL,
        "mainEntityOfPage": BASE_URL,
        "sameAs": REPOSITORY_URL,
        "codeRepository": REPOSITORY_URL,
        "version": version,
        "creativeWorkStatus": status_label,
        "dateModified": project.get("sourceDate") or generated_at,
        "identifier": [
            {"@type": "PropertyValue", "propertyID": "git", "value": source_commit},
            {"@type": "PropertyValue", "propertyID": "TeamForge release ID", "value": release_id},
        ],
        "additionalProperty": [
            {"@type": "PropertyValue", "name": "Release candidate state", "value": release_state},
            {"@type": "PropertyValue", "name": "Work package", "value": work_package},
            {"@type": "PropertyValue", "name": "Release target", "value": target},
        ],
        "isAccessibleForFree": True,
        "license": license_url,
        "programmingLanguage": languages,
        "runtimePlatform": runtime_display,
        "keywords": [
            "Unity Editor",
            "real-time collaboration",
            "scene synchronization",
            "presence",
            "locking",
            "P2P project transfer",
            "open source",
        ],
        "maintainer": {"@type": "Person", "name": maintainer},
        "subjectOf": [
            {"@type": "WebPage", "name": "TeamForge current status", "url": BASE_URL + "status/"},
            {"@type": "WebPage", "name": "How TeamForge works", "url": BASE_URL + "how-it-works/"},
            {"@type": "DigitalDocument", "name": "TeamForge release contract", "url": BASE_URL + "release-contract.json"},
            {"@type": "WebPage", "name": "TeamForge architecture", "url": BASE_URL + "architecture/"},
            {"@type": "WebPage", "name": "TeamForge source checkout/build/validation guide", "url": BASE_URL + "source/"},
            {"@type": "WebPage", "name": "TeamForge Test Lab", "url": BASE_URL + "test-lab/"},
            {"@type": "WebPage", "name": "TeamForge engineering guide", "url": BASE_URL + "engineering/"},
            {"@type": "WebPage", "name": "TeamForge documentation maintenance guide", "url": BASE_URL + "documentation/"},
            {"@type": "WebPage", "name": "TeamForge changelog", "url": BASE_URL + "changelog/"},
            {"@type": "WebPage", "name": "TeamForge security", "url": BASE_URL + "security/"},
            {"@type": "WebPage", "name": "TeamForge code map", "url": BASE_URL + "codemap.txt"},
            {"@type": "WebPage", "name": "TeamForge LLM discovery index", "url": BASE_URL + "llms.txt"},
            {"@type": "DataCatalog", "name": "TeamForge repository manifest", "url": BASE_URL + "repository-manifest.json"},
        ],
    }
    return json.dumps(payload, ensure_ascii=False, indent=2)


def build_head_block(project: dict[str, object]) -> str:
    return f'''{HEAD_START}
  <link rel="alternate" type="text/plain" href="{BASE_URL}llms.txt" title="TeamForge LLM discovery index">
  <link rel="alternate" type="text/plain" href="{BASE_URL}llms-full.txt" title="TeamForge full AI-readable context">
  <link rel="alternate" type="application/json" href="{BASE_URL}project.json" title="TeamForge project metadata">
  <link rel="alternate" type="application/json" href="{BASE_URL}release-contract.json" title="TeamForge release contract">
  <link rel="alternate" type="application/json" href="{BASE_URL}repository-manifest.json" title="TeamForge complete repository manifest">
  <link rel="alternate" type="text/plain" href="{BASE_URL}how-it-works.txt" title="How TeamForge works">
  <link rel="alternate" type="text/plain" href="{BASE_URL}codemap.txt" title="TeamForge code map">
  <link rel="alternate" type="text/plain" href="{BASE_URL}source.txt" title="TeamForge source checkout, build, and validation guide">
  <link rel="alternate" type="text/plain" href="{BASE_URL}test-lab.txt" title="TeamForge Test Lab">
  <link rel="alternate" type="text/markdown" href="{BASE_URL}sitemap.md" title="TeamForge semantic sitemap">
  <script type="application/ld+json">
{build_json_ld(project)}
  </script>
{HEAD_END}'''


def build_visible_section(project: dict[str, object]) -> str:
    status_label = html.escape(project_fact(project, "statusLabel"))
    summary = project_fact(project, "statusSummary")
    status_summary = html.escape(summary[:1].upper() + summary[1:])
    return f'''{SECTION_START}
    <section id="status" class="preview-summary"><div class="wrap">
      <div><span class="section-index">Project status &amp; verification</span><h2>{status_label}</h2></div>
      <div><p>{status_summary}.</p><a class="text-link" href="{BASE_URL}status/">Current readiness, blockers &amp; candidate →</a></div>
    </div></section>
{SECTION_END}'''


def build_semantic_sitemap(project: dict[str, object]) -> str:
    version = project_fact(project, "version")
    release_id = project_fact(project, "releaseId")
    release_state = project_fact(project, "releaseState")
    target = project_fact(project, "target")
    source_commit = project_fact(project, "sourceCommit")
    generated_at = project_fact(project, "generatedAt")
    status_label = project_fact(project, "statusLabel")
    runtime_display = project_fact(project, "runtimeDisplay")
    return f'''# TeamForge semantic sitemap

> Navigation for humans and AI systems that need a concise map of the current TeamForge project and its canonical evidence.

Current product version: **{version}**  
Current release ID: **{release_id}**  
Release candidate state: **{release_state}**  
Release target: **{target}**  
Project lifecycle status: **{status_label}**  
Runtime: **{runtime_display}**  
Source commit: **{source_commit}**  
Generated from canonical repository content: **{generated_at}**

## Start here

- [Website]({BASE_URL}): Human-facing overview with visible lifecycle, release-candidate, and source facts.
- [Project metadata]({BASE_URL}project.json): Machine-readable product/release identity, source commit, lifecycle status, documentation routes, module roles, and runtime metadata.
- [Release contract]({BASE_URL}release-contract.json): Source-controlled current candidate identity, work package, state, target, protocol, runtime, and toolchain contract.
- [Complete repository manifest]({BASE_URL}repository-manifest.json): Every git-tracked file, exact blob SHA, category, size, and source-commit-pinned GitHub URL.
- [LLM index]({BASE_URL}llms.txt): Retrieval/evidence rules and task-based routing.
- [Full AI-readable context]({BASE_URL}llms-full.txt): Curated current documentation plus the release contract in one plain-text resource; not a dump of historical/source files.

For a packaged build, product version and release ID are not sufficient to prove byte identity. Use the exact artifact filename and SHA-256 recorded for that packaged candidate. Current source can be newer than that artifact.

## Human-readable current documentation

- [Documentation hub]({BASE_URL}docs/): Task-oriented paths into canonical guides.
- [About TeamForge]({BASE_URL}about/): Origin and project philosophy.
- [Contributing]({BASE_URL}contributing/): Generated contribution policy.

- [Status]({BASE_URL}status/): Implementation, validation, limitations, blockers, source/package boundary, and release readiness. [Plain text]({BASE_URL}status.txt).
- [How it works]({BASE_URL}how-it-works/): Host/Guest/project-transfer/realtime/reconnect/recovery flow. [Plain text]({BASE_URL}how-it-works.txt).
- [Architecture]({BASE_URL}architecture/): As-built topology, authority, module responsibilities, and trust boundaries. [Plain text]({BASE_URL}architecture-overview.txt).
- [Source workflow]({BASE_URL}source/): Source checkout, build, validation, and test entry points. [Plain text]({BASE_URL}source.txt).
- [Test Lab]({BASE_URL}test-lab/): Named validation scenarios and evidence semantics. [Plain text]({BASE_URL}test-lab.txt).
- [Changelog]({BASE_URL}changelog/): Product-version changes. [Plain text]({BASE_URL}changelog.txt).
- [Security]({BASE_URL}security/): Security scope, reporting guidance, trust assumptions, and safe testing expectations. [Plain text]({BASE_URL}security.txt).

## Contributor and maintainer workflow

- [Engineering guide]({BASE_URL}engineering/): Change planning, risk, invariants, failure modes, and required evidence. [Plain text]({BASE_URL}engineering-guide.txt).
- [Documentation guide]({BASE_URL}documentation/): Canonical ownership, propagation, historical handling, and drift prevention. [Plain text]({BASE_URL}documentation-guide.txt).
- [Code map]({BASE_URL}codemap.txt): Question-to-module/file/test routing.
- [Contribution guide]({BASE_URL}contributing.txt): Contribution expectations and validation guidance.

## Current facts and evidence

- [Human README mirror]({BASE_URL}readme.txt): Current public overview without GitHub rendering chrome.
- [Roadmap]({BASE_URL}roadmap.txt): Planned direction; do not treat roadmap items as implemented facts.
- [Architecture decisions]({BASE_URL}architecture.txt): Important technical constraints and tradeoffs.
- [AI/search discovery design]({BASE_URL}ai-discovery.txt): Why multiple discovery/retrieval paths exist and what they do not guarantee.
- [AI/comment readability audit]({BASE_URL}comment-audit.txt): Comment policy and focused readability review.

## Code navigation

- [Code map]({BASE_URL}codemap.txt): Question-to-module/file/test routing.
- [Unity package guide]({BASE_URL}modules/unity-package.txt): Unity Editor client and Host UX.
- [Server guide]({BASE_URL}modules/server.txt): Realtime/session authority and project metadata coordination.
- [Project Peer guide]({BASE_URL}modules/project-peer.txt): Direct P2P project transfer, trust, and activation backend.
- [Launcher guide]({BASE_URL}modules/launcher.txt): Windows Guest Launcher, verified bundled runtime integrity, support diagnostics, and Unity handoff.

## Localized current documentation

- [Korean README]({BASE_URL}readme.ko.txt)
- [Korean current status]({BASE_URL}status.ko.txt)
- [Korean How It Works]({BASE_URL}how-it-works.ko.txt)
- [Korean roadmap]({BASE_URL}roadmap.ko.txt)

## Historical material

- [Phase history]({BASE_URL}history/phases/index.txt): Historical milestone notes.
- [Raw work-state history]({BASE_URL}history/work-state/index.txt): Engineering/debugging notes that may be superseded.
- For historical reports or any tracked path not mirrored above, use [repository-manifest.json]({BASE_URL}repository-manifest.json) to find the exact source-commit-pinned GitHub URL.

Historical notes should not override current source/tests, `status.txt`, `release-contract.json`, current module guides, or the current changelog.
'''


def main() -> None:
    args = parse_args()
    site_root = args.site_root.resolve()
    index_path = site_root / "index.html"
    project_path = site_root / "project.json"
    social_preview_path = site_root / "assets" / "teamforge-social-preview.jpg"
    if not index_path.is_file() or not project_path.is_file():
        raise SystemExit("Built site must contain index.html and project.json before enrichment")
    if not social_preview_path.is_file() or social_preview_path.stat().st_size == 0:
        raise SystemExit("Built site must contain the TeamForge social preview image")

    project = json.loads(project_path.read_text(encoding="utf-8"))
    for key in (
        "version",
        "releaseId",
        "workPackage",
        "releaseState",
        "target",
        "sourceCommit",
        "generatedAt",
        "statusLabel",
        "statusSummary",
        "runtimeDisplay",
        "maintainer",
    ):
        project_fact(project, key)
    if not isinstance(project.get("protocols"), dict) or not project["protocols"]:
        raise RuntimeError("project.json is missing the release protocol contract")

    render_doc_pages(site_root, project)
    project_path.write_text(json.dumps(project, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    source = index_path.read_text(encoding="utf-8")
    source = remove_marker_block(source, HEAD_START, HEAD_END)
    source = remove_marker_block(source, SECTION_START, SECTION_END)
    source = replace_existing_json_ld(source)
    source = improve_homepage_search_copy(source)
    if "</head>" not in source or "</main>" not in source:
        raise SystemExit("index.html is missing expected head/main closing tags")

    source = source.replace("</head>", build_head_block(project) + "\n</head>", 1)
    project_section = build_visible_section(project)
    marker = "<!-- teamforge-preview-summary -->"
    if source.count(marker) != 1:
        raise RuntimeError("homepage must have one generated preview summary slot")
    source = source.replace(marker, project_section, 1)

    index_path.write_text(source, encoding="utf-8")
    build_homepage_locales(Path(__file__).resolve().parents[1], site_root)
    (site_root / "sitemap.md").write_text(build_semantic_sitemap(project), encoding="utf-8")


if __name__ == "__main__":
    main()
