#!/usr/bin/env python3
"""Enrich the built TeamForge Pages site for search-grounded and direct-fetch AI clients.

The canonical project facts still come from repository files. This script consumes the
already-generated project.json so the visible HTML, JSON-LD, semantic sitemap and
machine-readable metadata all describe the same source commit.
"""

from __future__ import annotations

import argparse
import html
import json
from pathlib import Path

BASE_URL = "https://eun-si123.github.io/teamforge-unity-collab/"
REPOSITORY_URL = "https://github.com/Eun-si123/teamforge-unity-collab"
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


def build_json_ld(project: dict[str, object]) -> str:
    version = str(project["version"])
    generated_at = str(project["generatedAt"])
    source_commit = str(project["sourceCommit"])
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
        "creativeWorkStatus": "Early public preview",
        "dateModified": generated_at,
        "identifier": f"git:{source_commit}",
        "isAccessibleForFree": True,
        "license": "https://www.gnu.org/licenses/agpl-3.0.html",
        "programmingLanguage": ["C#", "JavaScript"],
        "runtimePlatform": "Unity 6.3 LTS Editor",
        "keywords": [
            "Unity Editor",
            "real-time collaboration",
            "scene synchronization",
            "presence",
            "locking",
            "P2P project transfer",
            "open source",
        ],
        "targetProduct": {
            "@type": "SoftwareApplication",
            "name": "Unity Editor",
            "applicationCategory": "DeveloperApplication",
        },
        "maintainer": {"@type": "Person", "name": "Eun-si123 / BlackProtogen"},
        "subjectOf": [
            {"@type": "WebPage", "name": "TeamForge current status", "url": BASE_URL + "status.txt"},
            {"@type": "WebPage", "name": "TeamForge code map", "url": BASE_URL + "codemap.txt"},
            {"@type": "WebPage", "name": "TeamForge source reading guide", "url": BASE_URL + "source.txt"},
            {"@type": "WebPage", "name": "TeamForge LLM discovery index", "url": BASE_URL + "llms.txt"},
        ],
    }
    return json.dumps(payload, ensure_ascii=False, indent=2)


def build_head_block(project: dict[str, object]) -> str:
    json_ld = build_json_ld(project)
    return f'''{HEAD_START}
  <link rel="alternate" type="text/plain" href="{BASE_URL}llms.txt" title="TeamForge LLM discovery index">
  <link rel="alternate" type="text/plain" href="{BASE_URL}llms-full.txt" title="TeamForge full AI-readable context">
  <link rel="alternate" type="text/plain" href="{BASE_URL}codemap.txt" title="TeamForge code map">
  <link rel="alternate" type="application/json" href="{BASE_URL}project.json" title="TeamForge project metadata">
  <link rel="alternate" type="text/markdown" href="{BASE_URL}sitemap.md" title="TeamForge semantic sitemap">
  <script type="application/ld+json">
{json_ld}
  </script>
{HEAD_END}'''


def build_visible_section(project: dict[str, object]) -> str:
    version = html.escape(str(project["version"]))
    source_commit = html.escape(str(project["sourceCommit"]))
    generated_at = html.escape(str(project["generatedAt"]))
    commit_url = f"{REPOSITORY_URL}/commit/{source_commit}"
    return f'''{SECTION_START}
    <section id="project-facts" aria-labelledby="project-facts-title">
      <div class="wrap">
        <h2 id="project-facts-title">Current project facts &amp; AI/search access</h2>
        <p class="section-intro">These facts are intentionally present as normal visible text, not only hidden metadata. Search engines, search-grounded assistants, coding agents, and people can therefore verify the same current project snapshot.</p>
        <div class="grid">
          <article class="card">
            <span class="tag good">Current snapshot</span>
            <h3>TeamForge {version}</h3>
            <p><strong>Status:</strong> Early public preview; no general-user installable release is recommended yet.<br><strong>Runtime:</strong> Unity 6.3 LTS Editor. <strong>Languages:</strong> C# and JavaScript. <strong>License:</strong> AGPLv3.<br><strong>Maintainer:</strong> Eun-si123 / BlackProtogen. <a href="{REPOSITORY_URL}">Canonical GitHub repository</a>.</p>
          </article>
          <article class="card">
            <span class="tag">Source identity</span>
            <h3>Generated from main</h3>
            <p><strong>Source commit:</strong> <a href="{commit_url}"><code>{source_commit}</code></a><br><strong>Pages snapshot:</strong> <time datetime="{generated_at}">{generated_at}</time></p>
          </article>
          <article class="card">
            <span class="tag">Canonical evidence</span>
            <h3>Verify before inferring</h3>
            <p>Use current source and tests for implementation, <code>STATUS.md</code> for release readiness, and module READMEs plus architecture documents for supported contracts and trust boundaries.</p>
          </article>
        </div>
        <div class="actions" aria-label="Machine-readable TeamForge resources">
          <a class="btn primary" href="{BASE_URL}llms.txt">LLM index</a>
          <a class="btn" href="{BASE_URL}project.json">Project JSON</a>
          <a class="btn" href="{BASE_URL}codemap.txt">Code map</a>
          <a class="btn" href="{BASE_URL}source.txt">Source reading guide</a>
          <a class="btn" href="{BASE_URL}sitemap.md">Semantic sitemap</a>
          <a class="btn" href="{BASE_URL}llms-full.txt">Full AI context</a>
        </div>
        <p class="small">If a search result, cached assistant answer, GitHub page, and this site disagree, compare <code>project.json</code>'s <code>sourceCommit</code> with the current repository default branch before concluding that a file or feature disappeared. Search and crawl indexes can lag behind the repository.</p>
      </div>
    </section>
{SECTION_END}'''


def build_semantic_sitemap(project: dict[str, object]) -> str:
    version = str(project["version"])
    source_commit = str(project["sourceCommit"])
    generated_at = str(project["generatedAt"])
    return f"""# TeamForge semantic sitemap

> Navigation for humans and AI systems that need a concise map of the current TeamForge project and its canonical evidence.

Current package version: **{version}**  
Project status: **Early public preview**  
Source commit: **{source_commit}**  
Generated from canonical repository content: **{generated_at}**

## Start here

- [Website]({BASE_URL}): Human-facing overview with visible current project facts.
- [Project metadata]({BASE_URL}project.json): Machine-readable version, source commit, status, documentation routes, and module roles.
- [LLM index]({BASE_URL}llms.txt): Retrieval/evidence rules and task-based routing.
- [Full AI-readable context]({BASE_URL}llms-full.txt): Curated current documentation in one plain-text resource.

## Current facts and evidence

- [Current status]({BASE_URL}status.txt): Capability, validation, blocker, and release-readiness claims.
- [Development history]({BASE_URL}changelog.txt): Version milestones plus detailed Unity package changelog.
- [Roadmap]({BASE_URL}roadmap.txt): Planned direction; do not treat roadmap items as implemented facts.
- [Architecture overview]({BASE_URL}architecture-overview.txt): As-built topology, authority and dependency boundaries.
- [Architecture decisions]({BASE_URL}architecture.txt): Important technical constraints and tradeoffs.
- [Security policy]({BASE_URL}security.txt): Security scope and reporting guidance.

## Code navigation

- [Code map]({BASE_URL}codemap.txt): Question-to-module/file/test routing.
- [Source / LLM reading guide]({BASE_URL}source.txt): Per-file purpose, cautions, and next-source guidance.
- [Unity package guide]({BASE_URL}modules/unity-package.txt): Unity Editor client and Host UX.
- [Server guide]({BASE_URL}modules/server.txt): Realtime/session authority and project metadata coordination.
- [Project Peer guide]({BASE_URL}modules/project-peer.txt): Direct P2P project transfer, trust, and activation.
- [Launcher guide]({BASE_URL}modules/launcher.txt): Windows Guest Launcher, bundled runtime integrity, and Unity handoff.
- [AI/comment readability audit]({BASE_URL}comment-audit.txt): Comment policy and focused readability review.

## Historical material

- [Phase history]({BASE_URL}history/phases/index.txt): Historical milestone notes.
- [Raw work-state history]({BASE_URL}history/work-state/index.txt): Engineering/debugging notes that may be superseded.

Historical notes should not override current source/tests, `status.txt`, current module guides, or the current changelog.
"""


def main() -> None:
    args = parse_args()
    site_root = args.site_root.resolve()
    index_path = site_root / "index.html"
    project_path = site_root / "project.json"
    if not index_path.is_file() or not project_path.is_file():
        raise SystemExit("Built site must contain index.html and project.json before enrichment")

    project = json.loads(project_path.read_text(encoding="utf-8"))
    for key in ("version", "sourceCommit", "generatedAt"):
        if not project.get(key):
            raise SystemExit(f"project.json is missing required field: {key}")

    source = index_path.read_text(encoding="utf-8")
    source = remove_marker_block(source, HEAD_START, HEAD_END)
    source = remove_marker_block(source, SECTION_START, SECTION_END)
    source = replace_existing_json_ld(source)

    if "</head>" not in source or "</main>" not in source:
        raise SystemExit("index.html is missing expected head/main closing tags")

    source = source.replace("</head>", build_head_block(project) + "\n</head>", 1)

    project_section = build_visible_section(project)
    feature_marker = '    <section id="features">'
    if feature_marker in source:
        source = source.replace(feature_marker, project_section + "\n\n" + feature_marker, 1)
    else:
        source = source.replace("</main>", project_section + "\n  </main>", 1)

    index_path.write_text(source, encoding="utf-8")
    (site_root / "sitemap.md").write_text(build_semantic_sitemap(project), encoding="utf-8")


if __name__ == "__main__":
    main()
