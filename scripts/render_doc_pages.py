#!/usr/bin/env python3
"""Render selected TeamForge Markdown mirrors as crawlable human-readable HTML pages."""

from __future__ import annotations

import argparse
import html
import json
import posixpath
import re
from pathlib import Path
from urllib.parse import urlparse

BASE_URL = "https://eun-si123.github.io/teamforge-unity-collab/"
REPOSITORY_URL = "https://github.com/Eun-si123/teamforge-unity-collab"

PAGES = (
    {
        "slug": "status",
        "source": "status.txt",
        "repo_source": "docs/STATUS.md",
        "title": "TeamForge Status — Implementation, Validation & Release Readiness",
        "heading": "Current status",
        "description": "Current TeamForge implementation, validation, limitations, blockers, and release-readiness status for the Unity Editor collaboration project.",
    },
    {
        "slug": "architecture",
        "source": "architecture-overview.txt",
        "repo_source": "docs/architecture.md",
        "title": "TeamForge Architecture — Unity Real-time Collaboration Design",
        "heading": "Architecture",
        "description": "As-built TeamForge architecture covering Unity Editor collaboration, realtime authority, P2P project transfer, trust boundaries, and module responsibilities.",
    },
    {
        "slug": "source",
        "source": "source.txt",
        "repo_source": "docs/SOURCE.md",
        "title": "TeamForge Source Guide — Code Navigation for Unity Collaboration",
        "heading": "Source reading guide",
        "description": "A code-reading guide for TeamForge: where Unity collaboration, server authority, P2P transfer, launcher, tests, trust boundaries, and diagnostics are implemented.",
    },
    {
        "slug": "changelog",
        "source": "changelog.txt",
        "repo_source": "CHANGELOG.md",
        "title": "TeamForge Changelog — Unity Collaboration Development History",
        "heading": "Development history",
        "description": "TeamForge version milestones and engineering history from early Unity Editor collaboration prototypes through current stabilization work.",
    },
    {
        "slug": "security",
        "source": "security.txt",
        "repo_source": ".github/SECURITY.md",
        "title": "TeamForge Security — Scope, Trust Boundaries & Reporting",
        "heading": "Security",
        "description": "TeamForge security scope, trust assumptions, current limitations, reporting guidance, and safe testing expectations for the experimental Unity collaboration project.",
    },
)

FENCE_RE = re.compile(r"^\s*```(?P<lang>[\w.+#-]*)\s*$")
HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
UL_RE = re.compile(r"^\s*[-*+]\s+(.+)$")
OL_RE = re.compile(r"^\s*\d+[.)]\s+(.+)$")
TABLE_SEPARATOR_RE = re.compile(r"^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("site_root", type=Path)
    return parser.parse_args()


def slugify(value: str) -> str:
    value = re.sub(r"<[^>]+>", "", value)
    value = re.sub(r"[`*_~]", "", value).strip().lower()
    value = re.sub(r"[^a-z0-9가-힣]+", "-", value).strip("-")
    return value or "section"


def resolve_link(target: str, repo_source: str) -> str:
    target = target.strip()
    if not target or target.startswith(("#", "mailto:")):
        return target
    parsed = urlparse(target)
    if parsed.scheme in {"http", "https"}:
        return target
    clean, sep, fragment = target.partition("#")
    source_dir = posixpath.dirname(repo_source)
    resolved = posixpath.normpath(posixpath.join(source_dir, clean))
    if clean.endswith("/"):
        url = f"{REPOSITORY_URL}/tree/main/{resolved.rstrip('/')}"
    else:
        url = f"{REPOSITORY_URL}/blob/main/{resolved}"
    if sep:
        url += "#" + fragment
    return url


def inline_markup(text: str, repo_source: str) -> str:
    placeholders: dict[str, str] = {}

    def stash(value: str) -> str:
        token = f"@@TF{len(placeholders)}@@"
        placeholders[token] = value
        return token

    def code_sub(match: re.Match[str]) -> str:
        return stash(f"<code>{html.escape(match.group(1), quote=False)}</code>")

    text = re.sub(r"`([^`\n]+)`", code_sub, text)

    def image_sub(match: re.Match[str]) -> str:
        alt = html.escape(match.group(1), quote=True)
        src = html.escape(resolve_link(match.group(2), repo_source), quote=True)
        return stash(f'<img src="{src}" alt="{alt}" loading="lazy">')

    text = re.sub(r"!\[([^\]]*)\]\(([^)]+)\)", image_sub, text)

    def link_sub(match: re.Match[str]) -> str:
        label = html.escape(match.group(1), quote=False)
        href = html.escape(resolve_link(match.group(2), repo_source), quote=True)
        return stash(f'<a href="{href}">{label}</a>')

    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", link_sub, text)
    text = html.escape(text, quote=False)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"__([^_]+)__", r"<strong>\1</strong>", text)
    text = re.sub(r"(?<!\*)\*([^*\n]+)\*(?!\*)", r"<em>\1</em>", text)
    text = re.sub(r"~~([^~]+)~~", r"<del>\1</del>", text)

    for token, value in placeholders.items():
        text = text.replace(html.escape(token), value)
    return text


def split_table_row(line: str) -> list[str]:
    value = line.strip().strip("|")
    return [cell.strip() for cell in value.split("|")]


def render_markdown(markdown: str, repo_source: str) -> str:
    lines = markdown.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    out: list[str] = []
    heading_ids: dict[str, int] = {}
    i = 0

    def heading_id(text: str) -> str:
        base = slugify(text)
        count = heading_ids.get(base, 0)
        heading_ids[base] = count + 1
        return base if count == 0 else f"{base}-{count + 1}"

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if not stripped:
            i += 1
            continue

        fence = FENCE_RE.match(line)
        if fence:
            lang = fence.group("lang")
            code: list[str] = []
            i += 1
            while i < len(lines) and not FENCE_RE.match(lines[i]):
                code.append(lines[i])
                i += 1
            if i < len(lines):
                i += 1
            klass = f' class="language-{html.escape(lang, quote=True)}"' if lang else ""
            out.append(f"<pre><code{klass}>{html.escape(chr(10).join(code))}</code></pre>")
            continue

        heading = HEADING_RE.match(line)
        if heading:
            level = len(heading.group(1))
            raw = heading.group(2)
            ident = heading_id(raw)
            out.append(f'<h{level} id="{ident}">{inline_markup(raw, repo_source)}</h{level}>')
            i += 1
            continue

        if stripped in {"---", "***", "___"}:
            out.append("<hr>")
            i += 1
            continue

        if "|" in line and i + 1 < len(lines) and TABLE_SEPARATOR_RE.match(lines[i + 1]):
            headers = split_table_row(line)
            i += 2
            rows: list[list[str]] = []
            while i < len(lines) and "|" in lines[i] and lines[i].strip():
                rows.append(split_table_row(lines[i]))
                i += 1
            out.append('<div class="table-wrap"><table><thead><tr>')
            out.extend(f"<th>{inline_markup(cell, repo_source)}</th>" for cell in headers)
            out.append("</tr></thead><tbody>")
            for row in rows:
                padded = row + [""] * max(0, len(headers) - len(row))
                out.append("<tr>")
                out.extend(f"<td>{inline_markup(cell, repo_source)}</td>" for cell in padded[: len(headers)])
                out.append("</tr>")
            out.append("</tbody></table></div>")
            continue

        if stripped.startswith(">"):
            quote: list[str] = []
            while i < len(lines) and lines[i].lstrip().startswith(">"):
                quote.append(lines[i].lstrip()[1:].lstrip())
                i += 1
            body = " ".join(inline_markup(part, repo_source) for part in quote)
            out.append(f"<blockquote><p>{body}</p></blockquote>")
            continue

        ul = UL_RE.match(line)
        if ul:
            items: list[str] = []
            while i < len(lines):
                match = UL_RE.match(lines[i])
                if not match:
                    break
                items.append(match.group(1))
                i += 1
            out.append("<ul>")
            out.extend(f"<li>{inline_markup(item, repo_source)}</li>" for item in items)
            out.append("</ul>")
            continue

        ol = OL_RE.match(line)
        if ol:
            items: list[str] = []
            while i < len(lines):
                match = OL_RE.match(lines[i])
                if not match:
                    break
                items.append(match.group(1))
                i += 1
            out.append("<ol>")
            out.extend(f"<li>{inline_markup(item, repo_source)}</li>" for item in items)
            out.append("</ol>")
            continue

        paragraph = [stripped]
        i += 1
        while i < len(lines):
            candidate = lines[i]
            candidate_stripped = candidate.strip()
            if not candidate_stripped:
                break
            if (
                FENCE_RE.match(candidate)
                or HEADING_RE.match(candidate)
                or UL_RE.match(candidate)
                or OL_RE.match(candidate)
                or candidate_stripped.startswith(">")
                or candidate_stripped in {"---", "***", "___"}
                or (
                    "|" in candidate
                    and i + 1 < len(lines)
                    and TABLE_SEPARATOR_RE.match(lines[i + 1])
                )
            ):
                break
            paragraph.append(candidate_stripped)
            i += 1
        out.append(f"<p>{inline_markup(' '.join(paragraph), repo_source)}</p>")

    return "\n".join(out)


def build_page(page: dict[str, str], markdown: str, project: dict[str, object]) -> str:
    slug = page["slug"]
    canonical = BASE_URL + slug + "/"
    raw_url = BASE_URL + page["source"]
    source_url = f"{REPOSITORY_URL}/blob/main/{page['repo_source']}"
    status_label = html.escape(str(project.get("statusLabel") or "Early Public Preview"))
    version = html.escape(str(project.get("version") or ""))
    description = html.escape(page["description"], quote=True)
    title = html.escape(page["title"])
    heading = html.escape(page["heading"])
    article = render_markdown(markdown, page["repo_source"])
    json_ld = json.dumps(
        {
            "@context": "https://schema.org",
            "@type": "TechArticle",
            "headline": page["title"],
            "description": page["description"],
            "url": canonical,
            "mainEntityOfPage": canonical,
            "isPartOf": {"@type": "WebSite", "name": "TeamForge", "url": BASE_URL},
            "about": {
                "@type": "SoftwareSourceCode",
                "name": "TeamForge",
                "codeRepository": REPOSITORY_URL,
            },
            "author": {"@type": "Person", "name": str(project.get("maintainer") or "Eun-si123 / BlackProtogen")},
            "isAccessibleForFree": True,
        },
        ensure_ascii=False,
        indent=2,
    )
    nav = "".join(
        f'<a href="{BASE_URL}{item["slug"]}/">{html.escape(item["heading"])}</a>'
        for item in PAGES
    )
    return f'''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title}</title>
  <meta name="description" content="{description}">
  <meta name="robots" content="index,follow,max-image-preview:large">
  <link rel="canonical" href="{canonical}">
  <link rel="alternate" type="text/plain" href="{raw_url}" title="Plain-text source mirror">
  <link rel="stylesheet" href="{BASE_URL}site-theme.css">
  <meta property="og:type" content="article">
  <meta property="og:title" content="{title}">
  <meta property="og:description" content="{description}">
  <meta property="og:url" content="{canonical}">
  <script type="application/ld+json">
{json_ld}
  </script>
  <style>
    :root {{
      color-scheme: dark;
      --bg:#1b1d21;
      --panel:#24272c;
      --panel2:#2a2d33;
      --text:#f1f2f4;
      --muted:#a6abb3;
      --quiet:#757b84;
      --line:#3a3e45;
      --line-strong:#4a4f58;
      --accent:#6db7ff;
      --accent-soft:#9bd0ff;
      --warn:#e6b86f;
      --max:1180px;
      --reading:900px;
      --mono:"SFMono-Regular",Consolas,"Liberation Mono",monospace;
    }}
    * {{ box-sizing:border-box; }}
    html {{ scroll-behavior:smooth; scroll-padding-top:72px; }}
    body {{ margin:0; min-height:100vh; font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; color:var(--text); background:var(--bg); line-height:1.7; -webkit-font-smoothing:antialiased; }}
    a {{ color:var(--accent-soft); text-underline-offset:.18em; }}
    :focus-visible {{ outline:2px solid var(--accent); outline-offset:3px; }}
    nav {{ position:sticky; top:0; z-index:20; border-bottom:1px solid var(--line); background:rgba(27,29,33,.96); backdrop-filter:blur(12px); }}
    .nav {{ width:min(calc(100% - 2.5rem),var(--max)); margin:auto; min-height:64px; display:flex; align-items:center; gap:1.05rem; }}
    .brand {{ display:inline-flex; align-items:center; gap:.72rem; margin-right:auto; color:var(--text); font-weight:720; letter-spacing:-.025em; text-decoration:none; }}
    .brand::before {{ content:""; width:22px; height:22px; border:1px solid #79808a; box-shadow:8px 10px 0 -7px var(--accent); }}
    .nav a:not(.brand) {{ color:var(--muted); text-decoration:none; font-size:.82rem; }}
    .nav a:not(.brand):hover {{ color:#fff; }}
    header,main,footer {{ width:min(calc(100% - 2.5rem),var(--max)); margin:auto; }}
    header {{ padding:clamp(4rem,7vw,6.4rem) 0 clamp(2.3rem,4vw,3.5rem); border-bottom:1px solid var(--line-strong); }}
    .eyebrow {{ color:var(--quiet); font:600 .68rem var(--mono); letter-spacing:.07em; text-transform:uppercase; }}
    h1 {{ max-width:12ch; margin:.85rem 0 1.15rem; font-size:clamp(3rem,7vw,6.3rem); line-height:.9; letter-spacing:-.065em; font-weight:760; text-wrap:balance; }}
    .lead {{ max-width:760px; margin:0; color:var(--muted); font-size:clamp(1rem,1.4vw,1.12rem); line-height:1.72; }}
    .meta {{ max-width:900px; margin-top:1.8rem; padding:.9rem 0; border-top:1px solid var(--line); border-bottom:1px solid var(--line); color:var(--quiet); background:transparent; font:.72rem/1.65 var(--mono); }}
    .meta strong {{ color:#d9dde2; font-weight:600; }}
    .meta a {{ color:#c6ccd3; }}
    .doc-content {{ width:min(100%,var(--reading)); padding:clamp(2.4rem,5vw,4.3rem) 0 clamp(4rem,7vw,6rem); }}
    .doc-content > h1:first-child {{ display:none; }}
    .doc-content h1 {{ margin:3rem 0 1rem; font-size:clamp(2rem,4vw,3rem); line-height:1.03; letter-spacing:-.04em; }}
    .doc-content h2 {{ margin:3.25rem 0 1rem; padding-top:1.1rem; border-top:1px solid var(--line-strong); font-size:clamp(1.55rem,3vw,2.15rem); line-height:1.15; letter-spacing:-.028em; }}
    .doc-content h3 {{ margin:2.15rem 0 .7rem; font-size:1.22rem; line-height:1.3; }}
    .doc-content h4,.doc-content h5,.doc-content h6 {{ margin:1.75rem 0 .65rem; }}
    .doc-content p,.doc-content li {{ color:#cfd3d8; }}
    .doc-content p {{ margin:.75rem 0 1.1rem; }}
    .doc-content ul,.doc-content ol {{ padding-left:1.25rem; }}
    .doc-content li + li {{ margin-top:.35rem; }}
    .doc-content strong {{ color:#f0f1f3; }}
    .doc-content code {{ padding:.1rem .3rem; border:1px solid #393e45; border-radius:2px; background:#191b1f; color:#d8dce1; font-family:var(--mono); }}
    pre {{ overflow:auto; margin:1.35rem 0; padding:1rem 1.05rem; border:1px solid var(--line-strong); border-radius:2px; background:#15171a; color:#d8dce1; }}
    pre code {{ border:0; padding:0; background:transparent; }}
    blockquote {{ margin:1.5rem 0; padding:.5rem 0 .5rem 1rem; border-left:2px solid var(--warn); background:transparent; }}
    blockquote p {{ margin:0; color:#cdbf9f!important; }}
    .table-wrap {{ overflow:auto; margin:1.5rem 0; border-top:1px solid var(--line-strong); border-bottom:1px solid var(--line-strong); }}
    table {{ width:100%; border-collapse:collapse; min-width:560px; }}
    th,td {{ padding:.68rem .72rem; border-bottom:1px solid var(--line); text-align:left; vertical-align:top; }}
    th {{ color:#e1e4e7; background:#202328; font-size:.78rem; }}
    td {{ color:#c6cbd1; font-size:.86rem; }}
    tr:last-child td {{ border-bottom:0; }}
    hr {{ margin:2.8rem 0; border:0; border-top:1px solid var(--line); }}
    img {{ max-width:100%; height:auto; border:1px solid var(--line-strong); }}
    footer {{ padding:2rem 0 4rem; border-top:1px solid var(--line); color:var(--quiet); font-size:.78rem; }}
    @media (max-width:900px) {{
      .nav {{ width:min(calc(100% - 1.5rem),var(--max)); gap:.7rem; }}
      .nav a:not(.brand):nth-of-type(n+4) {{ display:none; }}
      header,main,footer {{ width:min(calc(100% - 1.5rem),var(--max)); }}
      h1 {{ max-width:10ch; }}
    }}
    @media (max-width:620px) {{
      .nav a:not(.brand) {{ display:none; }}
      .nav a:last-child {{ display:inline; }}
      header,main,footer {{ width:calc(100% - 1rem); }}
      header {{ padding-top:3.3rem; }}
      h1 {{ font-size:clamp(2.8rem,15vw,4.4rem); }}
      .meta {{ font-size:.66rem; overflow-wrap:anywhere; }}
      .doc-content {{ padding-top:2rem; }}
      .doc-content h2 {{ margin-top:2.6rem; }}
      .table-wrap {{ margin-inline:-.5rem; padding-inline:.5rem; }}
    }}
    @media (prefers-reduced-motion:reduce) {{ html {{ scroll-behavior:auto; }} }}
  </style>
</head>
<body>
<nav aria-label="Documentation navigation"><div class="nav">
  <a class="brand" href="{BASE_URL}">TeamForge</a>{nav}
  <a href="{REPOSITORY_URL}">GitHub ↗</a>
</div></nav>
<header>
  <div class="eyebrow">TeamForge {version} · {status_label}</div>
  <h1>{heading}</h1>
  <p class="lead">{html.escape(page["description"])}</p>
  <div class="meta"><strong>Canonical source</strong> · <a href="{source_url}">{html.escape(page["repo_source"])}</a> · <a href="{raw_url}">plain-text mirror</a><br>
  Generated from the same maintained repository documentation used by the public project records and machine-readable mirrors.</div>
</header>
<main>
  <article class="doc-content">
{article}
  </article>
</main>
<footer>TeamForge is an early open-source Unity Editor collaboration project. This page is generated from canonical repository documentation.</footer>
</body>
</html>
'''


def add_routes(project: dict[str, object]) -> None:
    documentation = project.setdefault("documentation", {})
    if not isinstance(documentation, dict):
        raise RuntimeError("project.json documentation must be an object")
    documentation.update(
        {
            "statusHtml": BASE_URL + "status/",
            "architectureHtml": BASE_URL + "architecture/",
            "sourceGuideHtml": BASE_URL + "source/",
            "changelogHtml": BASE_URL + "changelog/",
            "securityHtml": BASE_URL + "security/",
        }
    )


def render_doc_pages(site_root: Path, project: dict[str, object]) -> None:
    add_routes(project)
    for page in PAGES:
        source_path = site_root / page["source"]
        if not source_path.is_file():
            raise RuntimeError(f"missing documentation mirror for HTML render: {page['source']}")
        output_dir = site_root / page["slug"]
        output_dir.mkdir(parents=True, exist_ok=True)
        output = build_page(page, source_path.read_text(encoding="utf-8"), project)
        (output_dir / "index.html").write_text(output, encoding="utf-8")


def main() -> None:
    args = parse_args()
    site_root = args.site_root.resolve()
    project_path = site_root / "project.json"
    if not project_path.is_file():
        raise SystemExit("built site is missing project.json")
    project = json.loads(project_path.read_text(encoding="utf-8"))
    render_doc_pages(site_root, project)
    project_path.write_text(json.dumps(project, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
