from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one marker, found {count}: {old[:80]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "README.md",
    "## Demo\n",
    """## Choose your path

You do not need to read the whole repository to understand or review TeamForge. Start with the path that matches your goal:

| I want to... | Start here |
| --- | --- |
| Understand what TeamForge does and how the pieces fit together | **[How TeamForge works](docs/HOW_IT_WORKS.md)** |
| See what works today, what is blocked, and whether it is ready for broader use | **[Current status](docs/STATUS.md)** |
| Build, test, or review the public source | **[Source guide](docs/SOURCE.md)** |
| Find the implementation and nearest tests for a behavior | **[Code map](CODEMAP.md)** |
| Understand architecture, authority, identity, or trust boundaries | **[Architecture](docs/architecture.md)** |
| Contribute a change | **[Contributing](.github/CONTRIBUTING.md)** and **[Engineering guide](docs/ENGINEERING_GUIDE.md)** |

Historical phase, work-state, decision, and evidence records are useful for archaeology, but they are not required pre-reading for an ordinary current question.

## Demo
""",
)
replace_once(
    "README.md",
    "- **[Work-state notes](docs/work-state/)** — implementation, debugging, hotfix, decision, and handoff notes",
    "- **[Historical work-state notes](docs/history/work-state/)** — preserved implementation, debugging, hotfix, and handoff snapshots",
)
replace_once(
    "README.md",
    "| [docs/work-state/](docs/work-state/) | Raw implementation, debugging, and stabilization notes |",
    "| [docs/history/work-state/](docs/history/work-state/) | Preserved implementation, debugging, stabilization, and handoff history |",
)

replace_once(
    "docs/HOW_IT_WORKS.md",
    "## The main processes\n",
    """### Terms used in the model

These names appear throughout the rest of the documentation:

- **Host** — the collaborator who starts sharing a Unity project/session.
- **Guest** — a collaborator joining a Host, potentially before a local Unity project exists.
- **TeamForge Server / Session Authority** — the process that decides accepted shared realtime state; it is the realtime referee, not the project-file relay.
- **Project Peer** — the Host/Guest-side process that sends or receives project payload bytes directly and verifies project content.
- **Verified Active revision** — a fully checked project revision selected for use only after the required integrity/trust/activation checks pass.

The sections below introduce more specialized terms where they first become relevant rather than requiring a large glossary up front.

## The main processes
""",
)

replace_once(
    "docs/STATUS.md",
    "## Current state at a glance\n",
    """## Short answer

**TeamForge is still FIELD BLOCKED.** Core collaboration and project-transfer paths exist and substantial stabilization fixes are present in source, but the remaining targeted physical two-PC Windows reruns have not been closed. A published packaged candidate exists, while current source can be newer than that immutable artifact. Keep backups, use disposable projects for early testing, and do not infer package behavior from later source-only changes.

If that is all you needed, stop here. The sections below provide the exact capability, package/source, evidence, and remaining-field-gate detail.

## Current state at a glance
""",
)

source = Path("docs/SOURCE.md")
text = source.read_text(encoding="utf-8")
start = text.index("## Source-of-truth order\n")
end = text.index("## Pull-request validation expectations\n")
replacement = """## Authority by question

There is no single useful global document ranking for every kind of claim. Start from the question, then verify against the exact source/test/contract or artifact identity that question requires.

| Question | Primary owner / evidence |
| --- | --- |
| What does the current source actually implement? | current source + nearest tests; use [CODEMAP.md](../CODEMAP.md) to find the smallest relevant surface |
| What is supported, blocked, or release-ready now? | [STATUS.md](STATUS.md) |
| What exact runtime/tool/protocol/release selections apply? | [`../release-contract.json`](../release-contract.json) |
| What exact packaged bytes were published or superseded? | [`../builds/README.md`](../builds/README.md) + exact GitHub Release filename/SHA-256 |
| How is the current system structured and where are trust boundaries? | [architecture.md](architecture.md) + current module READMEs |
| Why was an important design choice made? | [architecture-decisions.md](architecture-decisions.md) / matching ADR, checked against current architecture/source |
| What is the detailed state of a live bug? | GitHub Issues, with release effect summarized in STATUS when relevant |
| What is planned later? | [ROADMAP.md](ROADMAP.md) |
| What happened in an older phase/test/stabilization session? | dated evidence and `docs/history/` records, scoped to the exact revision/environment they recorded |

Do not average contradictory documents into a synthetic truth. A source commit may be newer than a packaged candidate; an accepted historical decision may later be superseded; a test record proves only what it actually exercised.

"""
source.write_text(text[:start] + replacement + text[end:], encoding="utf-8")
replace_once(
    "docs/SOURCE.md",
    "`docs/phases/`, `docs/work-state/`, dated patch/test notes, and audits are retained because they preserve useful engineering history. They may describe superseded behavior.",
    "`docs/history/`, `docs/phases/`, legacy `docs/work-state/` compatibility pointers, dated patch/test notes, and audits preserve useful engineering history. They may describe superseded behavior.",
)

replace_once(
    "docs/architecture.md",
    "## State lifetime\n",
    """## State ownership and lifetime at a glance

| State | Authority / owner | Stored where | Lifetime | Recovery / rebuild boundary |
| --- | --- | --- | --- | --- |
| Presence membership | Server Session Authority | server memory | live session | rebuilt from current membership/snapshot after join/rejoin |
| Transform / Lock / supported Hierarchy state | Server Session Authority | server memory | live session | clients rebind/reconcile from current authoritative state; durable server-restart recovery is not implemented |
| Project coordination metadata | Project Coordinator | server memory | current coordinator process/session | re-coordinate through a valid current session rather than treating stale local metadata as authority |
| Project chunks / staging content | Project Peer | local disk | durable local project-transfer state | verified content may be reused for resume when the transfer contract allows it |
| Immutable Active project revision + current pointer | Project Peer storage/backend | local disk | durable | failed/new transfer does not need to destroy the previous verified Active revision; pointer moves only after verification |
| Unity Authority View | Unity client | client memory | connection epoch | connection replacement clears connection-scoped authority and rebuilds it from the new authoritative state |

This table is a navigation summary, not a second state specification. The detailed contracts below and current source/tests remain authoritative for implementation behavior.

## State lifetime
""",
)

replace_once(
    "AGENTS.md",
    "- Do not treat historical `docs/work-state/`, `docs/phases/`, dated evidence notes, or engineering-history files as current truth when they conflict with current docs/code.",
    "- Do not treat `docs/history/`, legacy `docs/work-state/` compatibility material, `docs/phases/`, dated evidence notes, plans, or engineering-history files as current truth when they conflict with current docs/code.",
)

replace_once(
    ".github/workflows/pages.yml",
    '            for f in docs/work-state/*.md; do\n              base="$(basename "$f" .md)"',
    '            for f in docs/history/work-state/*.md; do\n              [[ "$(basename "$f")" == "README.md" ]] && continue\n              base="$(basename "$f" .md)"',
)

replace_once(
    "scripts/build-sitemap.py",
    '("history/work-state/index.txt", ("docs/work-state",)),',
    '("history/work-state/index.txt", ("docs/history/work-state",)),',
)
