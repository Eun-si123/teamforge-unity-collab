#!/usr/bin/env python3
"""Render crawlable TeamForge documentation, including maintained localized pages."""

from __future__ import annotations

import argparse
import html
import json
import posixpath
import re
import subprocess
from pathlib import Path
from urllib.parse import urlparse

BASE_URL = "https://eun-si123.github.io/teamforge-unity-collab/"
REPOSITORY_URL = "https://github.com/Eun-si123/teamforge-unity-collab"
I18N_HEAD_START = "<!-- teamforge-i18n-head:start -->"
I18N_HEAD_END = "<!-- teamforge-i18n-head:end -->"

PAGES = (
    {
        "slug": "status",
        "source": "status.txt",
        "repo_source": "docs/STATUS.md",
        "title": "TeamForge Status — Implementation, Validation & Release Readiness",
        "heading": "Current status",
        "description": "Current TeamForge implementation, validation, limitations, source-versus-package boundaries, blockers, and release-readiness status for the Unity Editor collaboration project.",
    },
    {
        "slug": "how-it-works",
        "source": "how-it-works.txt",
        "repo_source": "docs/HOW_IT_WORKS.md",
        "title": "How TeamForge Works — Host, Guest, P2P Transfer & Realtime Authority",
        "heading": "How TeamForge works",
        "description": "A guided end-to-end explanation of TeamForge hosting, joining, direct project transfer, realtime authority, locking, reconnect, and recovery.",
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
        "title": "TeamForge Source Guide — Checkout, Build & Validation",
        "heading": "Source workflow",
        "description": "Source checkout, build, fresh-clone validation, Launcher and Unity test entry points, and contributor verification workflow for TeamForge.",
    },
    {
        "slug": "test-lab",
        "source": "test-lab.txt",
        "repo_source": "docs/TEST_LAB.md",
        "title": "TeamForge Test Lab — Named Validation Scenarios & Evidence Boundaries",
        "heading": "Test Lab",
        "description": "Named TeamForge validation scenarios, local versus external evidence lanes, PASS/FAIL/INCOMPLETE semantics, and bounded failure-log behavior.",
    },
    {
        "slug": "engineering",
        "source": "engineering-guide.txt",
        "repo_source": "docs/ENGINEERING_GUIDE.md",
        "title": "TeamForge Engineering Guide — Change Planning, Risk & Evidence",
        "heading": "Engineering guide",
        "description": "TeamForge engineering change planning: scope, risk, invariants, failure modes, validation lanes, evidence, and release impact.",
    },
    {
        "slug": "documentation",
        "source": "documentation-guide.txt",
        "repo_source": "docs/DOCUMENTATION_GUIDE.md",
        "title": "TeamForge Documentation Guide — Ownership, Routing & Drift Prevention",
        "heading": "Documentation maintenance",
        "description": "TeamForge documentation ownership, planning, propagation, historical handling, and automated drift-prevention rules.",
    },
    {
        "slug": "changelog",
        "source": "changelog.txt",
        "repo_source": "CHANGELOG.md",
        "title": "TeamForge Changelog — Unity Collaboration Product Changes",
        "heading": "Product changelog",
        "description": "TeamForge product-version changes with links to detailed package and engineering history.",
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

KO_PAGES = {
    "status": {
        "source": "status.ko.txt",
        "repo_source": "docs/STATUS.ko.md",
        "english_repo_source": "docs/STATUS.md",
        "title": "TeamForge 현재 상태 — 구현, 검증 및 릴리스 준비도",
        "heading": "현재 상태",
        "description": "Unity Editor 협업 프로젝트 TeamForge의 현재 구현 범위, 검증 상태, 제한사항, 차단 요소와 릴리스 준비도를 설명합니다.",
    },
    "how-it-works": {
        "source": "how-it-works.ko.txt",
        "repo_source": "docs/HOW_IT_WORKS.ko.md",
        "english_repo_source": "docs/HOW_IT_WORKS.md",
        "title": "TeamForge 작동 방식 — Host, Guest, P2P 전송과 실시간 권한",
        "heading": "TeamForge 작동 방식",
        "description": "TeamForge의 호스팅, 참가, P2P 프로젝트 전송, 실시간 권한, 잠금, 재연결과 복구 흐름을 한국어로 설명합니다.",
    },
}

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
            out.append(
                f'<h{level} id="{heading_id(raw)}">{inline_markup(raw, repo_source)}</h{level}>'
            )
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
                out.extend(
                    f"<td>{inline_markup(cell, repo_source)}</td>"
                    for cell in padded[: len(headers)]
                )
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


def repository_root() -> Path | None:
    for candidate in (Path.cwd().resolve(), Path(__file__).resolve().parents[1]):
        if (candidate / ".git").exists():
            return candidate
    return None


def git_last_change(repo_source: str) -> str | None:
    root = repository_root()
    if root is None or not (root / repo_source).exists():
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


def translation_state(english_source: str, localized_source: str) -> tuple[str, str | None, str | None]:
    english_date = git_last_change(english_source)
    localized_date = git_last_change(localized_source)
    if not english_date or not localized_date:
        return "unknown", english_date, localized_date
    if localized_date < english_date:
        return "stale", english_date, localized_date
    return "current", english_date, localized_date


def alternate_links(english_url: str, korean_url: str) -> str:
    return "\n".join(
        (
            f'  <link rel="alternate" hreflang="en" href="{english_url}">',
            f'  <link rel="alternate" hreflang="ko" href="{korean_url}">',
            f'  <link rel="alternate" hreflang="x-default" href="{english_url}">',
        )
    )


def language_nav(slug: str, lang: str, has_korean: bool) -> str:
    english_url = BASE_URL + slug + "/"
    korean_url = BASE_URL + "ko/" + slug + "/"
    if lang == "ko":
        return (
            '<span class="language-switch" aria-label="언어 선택">'
            f'<a href="{english_url}" lang="en" hreflang="en">English</a>'
            '<span aria-hidden="true"> · </span><strong lang="ko" translate="no">한국어</strong>'
            "</span>"
        )
    if has_korean:
        return (
            '<span class="language-switch" aria-label="Language">'
            '<strong lang="en" translate="no">English</strong>'
            '<span aria-hidden="true"> · </span>'
            f'<a href="{korean_url}" lang="ko" hreflang="ko" translate="no">한국어</a>'
            "</span>"
        )
    return (
        '<span class="language-switch" aria-label="Language">'
        '<strong lang="en" translate="no">English</strong>'
        '<span aria-hidden="true"> · </span>'
        f'<a href="{BASE_URL}ko/" lang="ko" translate="no" title="Korean homepage; this document is not translated yet">한국어 홈</a>'
        "</span>"
    )


def doc_style() -> str:
    return """
    :root{color-scheme:dark;--bg:#1b1d21;--panel:#24272c;--text:#f1f2f4;--muted:#a6abb3;--quiet:#757b84;--line:#3a3e45;--line-strong:#4a4f58;--accent:#6db7ff;--accent-soft:#9bd0ff;--warn:#e6b86f;--max:1180px;--reading:900px;--mono:\"SFMono-Regular\",Consolas,\"Liberation Mono\",monospace}
    *{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:72px}body{margin:0;min-height:100vh;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;color:var(--text);background:var(--bg);line-height:1.7;-webkit-font-smoothing:antialiased}a{color:var(--accent-soft);text-underline-offset:.18em}:focus-visible{outline:2px solid var(--accent);outline-offset:3px}nav{position:sticky;top:0;z-index:20;border-bottom:1px solid var(--line);background:rgba(27,29,33,.96);backdrop-filter:blur(12px)}.nav{width:min(calc(100% - 2.5rem),var(--max));margin:auto;min-height:64px;display:flex;align-items:center;gap:1rem;flex-wrap:wrap}.brand{display:inline-flex;align-items:center;gap:.72rem;margin-right:auto;color:var(--text);font-weight:720;letter-spacing:-.025em;text-decoration:none}.brand::before{content:\"\";width:22px;height:22px;border:1px solid #79808a;box-shadow:8px 10px 0 -7px var(--accent)}.nav>a:not(.brand){color:var(--muted);text-decoration:none;font-size:.82rem}.nav>a:not(.brand):hover{color:#fff}.language-switch{font-size:.78rem;color:var(--quiet);white-space:nowrap}.language-switch a{color:#cfd3d8;text-decoration:none}.language-switch strong{color:#fff;font-weight:650}header,main,footer{width:min(calc(100% - 2.5rem),var(--max));margin:auto}header{padding:clamp(4rem,7vw,6.4rem) 0 clamp(2.3rem,4vw,3.5rem);border-bottom:1px solid var(--line-strong)}.eyebrow{color:var(--quiet);font:600 .68rem var(--mono);letter-spacing:.07em;text-transform:uppercase}h1{max-width:14ch;margin:.85rem 0 1.15rem;font-size:clamp(3rem,7vw,6.3rem);line-height:.94;letter-spacing:-.055em;font-weight:760;text-wrap:balance}.lead{max-width:800px;margin:0;color:var(--muted);font-size:clamp(1rem,1.4vw,1.12rem);line-height:1.72}.meta{max-width:920px;margin-top:1.8rem;padding:.9rem 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);color:var(--quiet);font:.72rem/1.65 var(--mono)}.meta strong{color:#d9dde2;font-weight:600}.notice{max-width:920px;margin:1rem 0 0;padding:.8rem 1rem;border-left:2px solid var(--warn);background:#211f1a;color:#d4c6a7;font-size:.84rem}.doc-content{width:min(100%,var(--reading));padding:clamp(2.4rem,5vw,4.3rem) 0 clamp(4rem,7vw,6rem)}.doc-content>h1:first-child{display:none}.doc-content h1{margin:3rem 0 1rem;font-size:clamp(2rem,4vw,3rem);line-height:1.03;letter-spacing:-.04em}.doc-content h2{margin:3.25rem 0 1rem;padding-top:1.1rem;border-top:1px solid var(--line-strong);font-size:clamp(1.55rem,3vw,2.15rem);line-height:1.15;letter-spacing:-.028em}.doc-content h3{margin:2.15rem 0 .7rem;font-size:1.22rem;line-height:1.3}.doc-content p,.doc-content li{color:#cfd3d8}.doc-content p{margin:.75rem 0 1.1rem}.doc-content ul,.doc-content ol{padding-left:1.25rem}.doc-content li+li{margin-top:.35rem}.doc-content strong{color:#f0f1f3}.doc-content code{padding:.1rem .3rem;border:1px solid #393e45;border-radius:2px;background:#191b1f;color:#d8dce1;font-family:var(--mono)}pre{overflow:auto;margin:1.35rem 0;padding:1rem 1.05rem;border:1px solid var(--line-strong);border-radius:2px;background:#15171a;color:#d8dce1}pre code{border:0;padding:0;background:transparent}blockquote{margin:1.5rem 0;padding:.5rem 0 .5rem 1rem;border-left:2px solid var(--warn)}blockquote p{margin:0;color:#cdbf9f!important}.table-wrap{overflow:auto;margin:1.5rem 0;border-top:1px solid var(--line-strong);border-bottom:1px solid var(--line-strong)}table{width:100%;border-collapse:collapse;min-width:560px}th,td{padding:.68rem .72rem;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{color:#e1e4e7;background:#202328;font-size:.78rem}td{color:#c6cbd1;font-size:.86rem}tr:last-child td{border-bottom:0}hr{margin:2.8rem 0;border:0;border-top:1px solid var(--line)}img{max-width:100%;height:auto;border:1px solid var(--line-strong)}footer{padding:2rem 0 4rem;border-top:1px solid var(--line);color:var(--quiet);font-size:.78rem}@media(max-width:900px){.nav{width:min(calc(100% - 1.5rem),var(--max))}.nav>a:not(.brand):nth-of-type(n+5){display:none}header,main,footer{width:min(calc(100% - 1.5rem),var(--max))}}@media(max-width:620px){.nav>a:not(.brand){display:none}.language-switch{display:inline-flex;margin-left:auto}header,main,footer{width:calc(100% - 1rem)}header{padding-top:3.3rem}h1{font-size:clamp(2.8rem,15vw,4.4rem)}.meta{font-size:.66rem;overflow-wrap:anywhere}.table-wrap{margin-inline:-.5rem;padding-inline:.5rem}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
    """.strip()


def build_page(
    page: dict[str, str],
    markdown: str,
    project: dict[str, object],
    *,
    lang: str = "en",
    localized: dict[str, str] | None = None,
) -> str:
    slug = page["slug"]
    if lang == "ko":
        if localized is None:
            raise RuntimeError("Korean page requires localized metadata")
        source = localized["source"]
        repo_source = localized["repo_source"]
        title_text = localized["title"]
        heading_text = localized["heading"]
        description_text = localized["description"]
        canonical = BASE_URL + "ko/" + slug + "/"
        english_url = BASE_URL + slug + "/"
        raw_url = BASE_URL + source
        has_korean = True
        state, english_date, localized_date = translation_state(
            localized["english_repo_source"], repo_source
        )
    else:
        source = page["source"]
        repo_source = page["repo_source"]
        title_text = page["title"]
        heading_text = page["heading"]
        description_text = page["description"]
        canonical = BASE_URL + slug + "/"
        english_url = canonical
        raw_url = BASE_URL + source
        has_korean = slug in KO_PAGES
        state, english_date, localized_date = "current", None, None

    korean_url = BASE_URL + "ko/" + slug + "/"
    alternates = alternate_links(english_url, korean_url) if has_korean else ""
    source_url = f"{REPOSITORY_URL}/blob/main/{repo_source}"
    status_label = html.escape(str(project.get("statusLabel") or "Early Public Preview"))
    version = html.escape(str(project.get("version") or ""))
    article = render_markdown(markdown, repo_source)
    description = html.escape(description_text, quote=True)
    title = html.escape(title_text)
    heading = html.escape(heading_text)

    if lang == "ko":
        eyebrow = f"TeamForge {version} · 한국어 문서"
        source_label = "기준 소스"
        mirror_label = "일반 텍스트 미러"
        source_note = "이 페이지는 저장소에서 관리되는 한국어 문서를 정적 HTML로 생성한 것입니다."
        footer = "TeamForge는 Unity Editor 실시간 협업을 실험하는 오픈소스 프로젝트입니다. 한국어 번역은 영어 원문과 별도로 유지·검증됩니다."
        stale_notice = ""
        if state == "stale":
            stale_notice = (
                '<div class="notice" role="note"><strong>번역 최신성 알림:</strong> '
                f'한국어 문서의 마지막 변경일({html.escape(localized_date or "unknown")})이 '
                f'영어 원문({html.escape(english_date or "unknown")})보다 오래되었습니다. '
                f'<a href="{english_url}">최신 영어 원문</a>도 함께 확인해 주세요.</div>'
            )
    else:
        eyebrow = f"TeamForge {version} · {status_label}"
        source_label = "Canonical source"
        mirror_label = "plain-text mirror"
        source_note = "Generated from the same maintained repository documentation used by the public project records and machine-readable mirrors."
        footer = "TeamForge is an early open-source Unity Editor collaboration project. This page is generated from canonical repository documentation."
        stale_notice = ""

    json_ld = json.dumps(
        {
            "@context": "https://schema.org",
            "@type": "TechArticle",
            "headline": title_text,
            "description": description_text,
            "url": canonical,
            "mainEntityOfPage": canonical,
            "inLanguage": lang,
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

    if lang == "ko":
        nav_items = (
            f'<a href="{BASE_URL}ko/status/">현재 상태</a>'
            f'<a href="{BASE_URL}ko/how-it-works/">작동 방식</a>'
            f'<a href="{BASE_URL}">English site</a>'
        )
        nav_label = "문서 탐색"
    else:
        nav_items = "".join(
            f'<a href="{BASE_URL}{item["slug"]}/">{html.escape(item["heading"])}</a>'
            for item in PAGES
        )
        nav_label = "Documentation navigation"

    return f'''<!doctype html>
<html lang="{lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title}</title>
  <meta name="description" content="{description}">
  <meta name="robots" content="index,follow,max-image-preview:large">
  <link rel="canonical" href="{canonical}">
{alternates}
  <link rel="alternate" type="text/plain" href="{raw_url}" title="Plain-text source mirror">
  <link rel="stylesheet" href="{BASE_URL}site-theme.css">
  <meta property="og:type" content="article">
  <meta property="og:title" content="{title}">
  <meta property="og:description" content="{description}">
  <meta property="og:url" content="{canonical}">
  <script type="application/ld+json">
{json_ld}
  </script>
  <style>{doc_style()}</style>
</head>
<body>
<nav aria-label="{nav_label}"><div class="nav">
  <a class="brand" href="{BASE_URL if lang == 'en' else BASE_URL + 'ko/'}">TeamForge</a>{nav_items}
  {language_nav(slug, lang, has_korean)}
  <a href="{REPOSITORY_URL}">GitHub ↗</a>
</div></nav>
<header>
  <div class="eyebrow">{eyebrow}</div>
  <h1>{heading}</h1>
  <p class="lead">{html.escape(description_text)}</p>
  {stale_notice}
  <div class="meta"><strong>{source_label}</strong> · <a href="{source_url}">{html.escape(repo_source)}</a> · <a href="{raw_url}">{mirror_label}</a><br>
  {source_note}</div>
</header>
<main>
  <article class="doc-content">
{article}
  </article>
</main>
<footer>{footer}</footer>
</body>
</html>
'''


def remove_marker_block(text: str, start: str, end: str) -> str:
    while start in text and end in text:
        before, remainder = text.split(start, 1)
        _, after = remainder.split(end, 1)
        text = before + after
    return text


def enhance_english_homepage(site_root: Path) -> None:
    path = site_root / "index.html"
    text = path.read_text(encoding="utf-8")
    text = remove_marker_block(text, I18N_HEAD_START, I18N_HEAD_END)
    block = (
        f"{I18N_HEAD_START}\n"
        + alternate_links(BASE_URL, BASE_URL + "ko/")
        + f"\n{I18N_HEAD_END}"
    )
    if "</head>" not in text:
        raise RuntimeError("homepage is missing </head> for i18n annotations")
    text = text.replace("</head>", block + "\n</head>", 1)

    old = '<a href="#korean">한국어</a>'
    new = (
        f'<a href="{BASE_URL}ko/" lang="ko" hreflang="ko" '
        'translate="no" title="한국어 사이트">한국어</a>'
    )
    if old in text:
        text = text.replace(old, new, 1)
    elif new not in text:
        raise RuntimeError("homepage language-link anchor changed unexpectedly")
    path.write_text(text, encoding="utf-8")


def build_korean_homepage(site_root: Path, project: dict[str, object]) -> None:
    source_path = site_root / "readme.ko.txt"
    if not source_path.is_file():
        raise RuntimeError("missing Korean README mirror for localized homepage")
    canonical = BASE_URL + "ko/"
    title_text = "TeamForge — Unity Editor 실시간 협업 오픈소스 프로젝트"
    description_text = (
        "TeamForge는 Unity Editor를 위한 오픈소스 실시간 협업 프로젝트로, "
        "Scene 동기화, Presence, 잠금/소유권과 P2P 프로젝트 전송을 탐구합니다."
    )
    state, english_date, localized_date = translation_state("README.md", "README.ko.md")
    stale_notice = ""
    if state == "stale":
        stale_notice = (
            '<div class="notice" role="note"><strong>번역 최신성 알림:</strong> '
            f'한국어 README의 마지막 변경일({html.escape(localized_date or "unknown")})이 '
            f'영어 README({html.escape(english_date or "unknown")})보다 오래되었습니다. '
            f'<a href="{BASE_URL}">영어 원문 사이트</a>에서 최신 상태도 확인해 주세요.</div>'
        )
    article = render_markdown(source_path.read_text(encoding="utf-8"), "README.ko.md")
    project_version = html.escape(str(project.get("version") or ""))
    json_ld = json.dumps(
        {
            "@context": "https://schema.org",
            "@type": "WebPage",
            "name": title_text,
            "description": description_text,
            "url": canonical,
            "inLanguage": "ko",
            "mainEntity": {
                "@type": "SoftwareSourceCode",
                "name": "TeamForge",
                "codeRepository": REPOSITORY_URL,
                "runtimePlatform": "Unity Editor",
            },
        },
        ensure_ascii=False,
        indent=2,
    )
    output = f'''<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html.escape(title_text)}</title>
  <meta name="description" content="{html.escape(description_text, quote=True)}">
  <meta name="robots" content="index,follow,max-image-preview:large">
  <link rel="canonical" href="{canonical}">
{alternate_links(BASE_URL, canonical)}
  <link rel="stylesheet" href="{BASE_URL}site-theme.css">
  <meta property="og:type" content="website">
  <meta property="og:title" content="{html.escape(title_text)}">
  <meta property="og:description" content="{html.escape(description_text, quote=True)}">
  <meta property="og:url" content="{canonical}">
  <script type="application/ld+json">
{json_ld}
  </script>
  <style>{doc_style()}</style>
</head>
<body>
<nav aria-label="주요 탐색"><div class="nav">
  <a class="brand" href="{canonical}">TeamForge</a>
  <a href="{BASE_URL}ko/status/">현재 상태</a>
  <a href="{BASE_URL}ko/how-it-works/">작동 방식</a>
  <a href="{REPOSITORY_URL}/blob/main/README.ko.md">한국어 README</a>
  <span class="language-switch" aria-label="언어 선택"><a href="{BASE_URL}" lang="en" hreflang="en" translate="no">English</a><span aria-hidden="true"> · </span><strong lang="ko" translate="no">한국어</strong></span>
  <a href="{REPOSITORY_URL}">GitHub ↗</a>
</div></nav>
<header>
  <div class="eyebrow">TeamForge {project_version} · 한국어</div>
  <h1>Unity Editor 안에서 함께 작업하기.</h1>
  <p class="lead">{html.escape(description_text)}</p>
  {stale_notice}
  <div class="meta"><strong>번역 원본</strong> · <a href="{REPOSITORY_URL}/blob/main/README.ko.md">README.ko.md</a><br>한국어 페이지는 저장소에서 관리되는 번역 문서를 기반으로 정적으로 생성됩니다. 자동 번역 결과를 검색용 페이지로 대량 생성하지 않습니다.</div>
</header>
<main><article class="doc-content">
{article}
</article></main>
<footer>TeamForge 한국어 사이트 · 번역이 없는 문서는 영어 원문을 기준으로 합니다.</footer>
</body>
</html>
'''
    output_dir = site_root / "ko"
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "index.html").write_text(output, encoding="utf-8")


def add_routes(project: dict[str, object]) -> None:
    documentation = project.setdefault("documentation", {})
    if not isinstance(documentation, dict):
        raise RuntimeError("project.json documentation must be an object")
    documentation.update(
        {
            "statusHtml": BASE_URL + "status/",
            "howItWorksHtml": BASE_URL + "how-it-works/",
            "architectureHtml": BASE_URL + "architecture/",
            "sourceGuideHtml": BASE_URL + "source/",
            "testLabHtml": BASE_URL + "test-lab/",
            "engineeringGuideHtml": BASE_URL + "engineering/",
            "documentationGuideHtml": BASE_URL + "documentation/",
            "changelogHtml": BASE_URL + "changelog/",
            "securityHtml": BASE_URL + "security/",
        }
    )

    localized = project.setdefault("localizedDocumentation", {})
    if not isinstance(localized, dict):
        raise RuntimeError("project.json localizedDocumentation must be an object")
    korean = localized.setdefault("ko", {})
    if not isinstance(korean, dict):
        raise RuntimeError("project.json localizedDocumentation.ko must be an object")
    korean.update(
        {
            "homeHtml": BASE_URL + "ko/",
            "statusHtml": BASE_URL + "ko/status/",
            "howItWorksHtml": BASE_URL + "ko/how-it-works/",
        }
    )


def verify_i18n_outputs(site_root: Path) -> None:
    english_home = (site_root / "index.html").read_text(encoding="utf-8")
    korean_home = (site_root / "ko" / "index.html").read_text(encoding="utf-8")
    if '<html lang="en">' not in english_home or '<html lang="ko">' not in korean_home:
        raise RuntimeError("homepage lang metadata is incomplete")
    for code, url in (("en", BASE_URL), ("ko", BASE_URL + "ko/"), ("x-default", BASE_URL)):
        tag = f'hreflang="{code}" href="{url}"'
        if tag not in english_home or tag not in korean_home:
            raise RuntimeError(f"homepage hreflang reciprocity missing: {tag}")
    if 'href="#korean">한국어</a>' in english_home:
        raise RuntimeError("English homepage still uses an in-page Korean anchor instead of the localized site")

    for slug in KO_PAGES:
        english_path = site_root / slug / "index.html"
        korean_path = site_root / "ko" / slug / "index.html"
        if not english_path.is_file() or not korean_path.is_file():
            raise RuntimeError(f"localized document pair is missing: {slug}")
        english_text = english_path.read_text(encoding="utf-8")
        korean_text = korean_path.read_text(encoding="utf-8")
        if '<html lang="en">' not in english_text or '<html lang="ko">' not in korean_text:
            raise RuntimeError(f"localized document lang metadata is incomplete: {slug}")
        english_url = BASE_URL + slug + "/"
        korean_url = BASE_URL + "ko/" + slug + "/"
        for code, url in (("en", english_url), ("ko", korean_url), ("x-default", english_url)):
            tag = f'hreflang="{code}" href="{url}"'
            if tag not in english_text or tag not in korean_text:
                raise RuntimeError(f"document hreflang reciprocity missing for {slug}: {tag}")


def render_doc_pages(site_root: Path, project: dict[str, object]) -> None:
    add_routes(project)
    enhance_english_homepage(site_root)

    for page in PAGES:
        source_path = site_root / page["source"]
        if not source_path.is_file():
            raise RuntimeError(f"missing documentation mirror for HTML render: {page['source']}")
        output_dir = site_root / page["slug"]
        output_dir.mkdir(parents=True, exist_ok=True)
        output = build_page(page, source_path.read_text(encoding="utf-8"), project)
        (output_dir / "index.html").write_text(output, encoding="utf-8")

        localized = KO_PAGES.get(page["slug"])
        if localized is not None:
            localized_source = site_root / localized["source"]
            if not localized_source.is_file():
                raise RuntimeError(
                    f"missing Korean documentation mirror for HTML render: {localized['source']}"
                )
            localized_dir = site_root / "ko" / page["slug"]
            localized_dir.mkdir(parents=True, exist_ok=True)
            localized_output = build_page(
                page,
                localized_source.read_text(encoding="utf-8"),
                project,
                lang="ko",
                localized=localized,
            )
            (localized_dir / "index.html").write_text(localized_output, encoding="utf-8")

    build_korean_homepage(site_root, project)
    verify_i18n_outputs(site_root)


def main() -> None:
    args = parse_args()
    site_root = args.site_root.resolve()
    project_path = site_root / "project.json"
    if not project_path.is_file():
        raise SystemExit("built site is missing project.json")
    project = json.loads(project_path.read_text(encoding="utf-8"))
    render_doc_pages(site_root, project)
    project_path.write_text(
        json.dumps(project, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
