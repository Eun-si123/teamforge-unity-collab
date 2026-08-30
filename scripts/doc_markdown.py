"""Small dependency-free Markdown renderer used by the TeamForge Pages documentation build."""

from __future__ import annotations

import html
import posixpath
import re
from urllib.parse import urlparse

REPOSITORY_URL = "https://github.com/Eun-si123/teamforge-unity-collab"

FENCE_RE = re.compile(r"^\s*```(?P<lang>[\w.+#-]*)\s*$")
HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
UL_RE = re.compile(r"^\s*[-*+]\s+(.+)$")
OL_RE = re.compile(r"^\s*\d+[.)]\s+(.+)$")
TABLE_SEPARATOR_RE = re.compile(r"^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$")


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
            out.append(f'<h{level} id="{heading_id(raw)}">{inline_markup(raw, repo_source)}</h{level}>')
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
