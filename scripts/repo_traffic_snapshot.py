#!/usr/bin/env python3
"""Archive a UTC-aligned GitHub Traffic / Actions comparison as an Actions artifact.

Only aggregated repository traffic is collected. No user, IP, device or token
data is recorded. Traffic endpoints require a separately configured fine-grained
token with repository Administration: read; GITHUB_TOKEN alone is insufficient.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

FIELDS = ("date_utc", "clones", "unique_cloners_daily",
          "views", "unique_visitors_daily", "actions_runs")


def api_json(path: str, token: str) -> object:
    if not token:
        raise ValueError("API token is required")
    url = "https://api.github.com" + path
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": "Bearer " + token,
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "teamforge-repo-traffic-snapshot/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        # Avoid printing URL query strings, request headers or secret values.
        raise RuntimeError(
            f"GitHub API returned HTTP {exc.code} for repository metrics"
        ) from exc


def recent_days(today: date) -> list[str]:
    """14 UTC calendar dates ending today, matching Traffic's rolling window."""
    return [(today - timedelta(days=offset)).isoformat() for offset in range(13, -1, -1)]


def indexed_daily(payload: object, key: str) -> dict[str, dict[str, int]]:
    if not isinstance(payload, dict) or not isinstance(payload.get(key), list):
        raise ValueError(f"missing GitHub Traffic daily array: {key}")
    daily: dict[str, dict[str, int]] = {}
    for item in payload[key]:
        if not isinstance(item, dict):
            raise ValueError("invalid GitHub Traffic daily entry")
        day = str(item.get("timestamp", ""))[:10]
        if len(day) != 10 or day in daily:
            raise ValueError("invalid or duplicate GitHub Traffic day")
        daily[day] = {"count": int(item["count"]), "uniques": int(item["uniques"])}
    return daily


def build_snapshot(
    repository: str,
    today: date,
    fetch,
    *,
    actions_token: str,
    traffic_token: str = "",
) -> dict:
    if "/" not in repository or repository.count("/") != 1:
        raise ValueError("expected owner/repository")
    repo = urllib.parse.quote(repository, safe="/")
    days = recent_days(today)
    # Counts of all completed/queued/running workflow runs created on each UTC
    # day, not just successful ones. They describe automation load, not human use.
    actions: dict[str, int] = {}
    for day in days:
        query = urllib.parse.urlencode({"created": day, "per_page": 1})
        data = fetch(f"/repos/{repo}/actions/runs?{query}", actions_token)
        if not isinstance(data, dict) or not isinstance(data.get("total_count"), int):
            raise ValueError(f"invalid Actions run count for {day}")
        actions[day] = data["total_count"]

    snapshot = {
        "schemaVersion": 1,
        "repository": repository,
        "capturedAtUtc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "datesUtc": days,
        "actionsRuns": actions,
        "actionsRunTotal": sum(actions.values()),
        "trafficStatus": "not_configured",
        "traffic": None,
    }
    if not traffic_token:
        return snapshot

    clones = fetch(f"/repos/{repo}/traffic/clones?per=day", traffic_token)
    views = fetch(f"/repos/{repo}/traffic/views?per=day", traffic_token)
    paths = fetch(f"/repos/{repo}/traffic/popular/paths", traffic_token)
    referrers = fetch(f"/repos/{repo}/traffic/popular/referrers", traffic_token)
    clone_daily = indexed_daily(clones, "clones")
    view_daily = indexed_daily(views, "views")
    if not isinstance(paths, list) or not isinstance(referrers, list):
        raise ValueError("invalid GitHub Traffic popular path/referrer payload")
    snapshot["trafficStatus"] = "available"
    snapshot["traffic"] = {
        "clones": {"total": int(clones["count"]),
                   "unique14d": int(clones["uniques"]), "daily": clone_daily},
        "views": {"total": int(views["count"]),
                  "unique14d": int(views["uniques"]), "daily": view_daily},
        "popularPaths": paths,
        "referrers": referrers,
    }
    return snapshot


def csv_rows(snapshot: dict) -> list[dict]:
    traffic = snapshot["traffic"]
    clones = traffic["clones"]["daily"] if traffic else {}
    views = traffic["views"]["daily"] if traffic else {}
    rows = []
    for day in snapshot["datesUtc"]:
        c, v = clones.get(day), views.get(day)
        rows.append({
            "date_utc": day,
            "clones": c["count"] if c is not None else (0 if traffic else ""),
            "unique_cloners_daily": c["uniques"] if c is not None else (0 if traffic else ""),
            "views": v["count"] if v is not None else (0 if traffic else ""),
            "unique_visitors_daily": v["uniques"] if v is not None else (0 if traffic else ""),
            "actions_runs": snapshot["actionsRuns"][day],
        })
    return rows


def render_report(snapshot: dict) -> str:
    dates = snapshot["datesUtc"]
    lines = [
        "# TeamForge GitHub traffic observation",
        "",
        f"- Captured UTC: {snapshot['capturedAtUtc']}",
        f"- Repository: `{snapshot['repository']}`",
        f"- UTC calendar days: {dates[0]} through {dates[-1]} (last day may be partial)",
        f"- GitHub Actions runs created across the window: **{snapshot['actionsRunTotal']:,}**",
        "",
    ]
    t = snapshot["traffic"]
    if t is None:
        lines += [
            "**Traffic collection not configured.** Only public Actions run counts were recorded.",
            "Add a fine-grained PAT in the repository Actions secret `TEAMFORGE_TRAFFIC_READ_TOKEN`",
            "with access to this repository and **Administration: read** (no write).",
            "Do not interpret blank traffic cells as zero.",
            "",
        ]
    else:
        lines += [
            f"- GitHub clones (14-day API total): **{t['clones']['total']:,}**",
            f"- Unique cloners (14-day API total): **{t['clones']['unique14d']:,}**",
            f"- GitHub page views (14-day API total): **{t['views']['total']:,}**",
            f"- Unique visitors (14-day API total): **{t['views']['unique14d']:,}**",
            "",
        ]
    lines += [
        "| UTC date | Clones | Daily unique cloners | Views | Daily unique visitors | Actions runs |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for row in csv_rows(snapshot):
        lines.append("| " + " | ".join(str(row[field]) for field in FIELDS) + " |")
    lines += [
        "",
        "**Interpretation:** Actions runs include all workflow types; some may",
        "checkout or clone the repository, while bots and other non-human services",
        "may clone without an Actions run. Correlation is not causal attribution.",
        "A GitHub unique cloner is not a verified human or a TeamForge user.",
        "Do **not** add daily unique counts to estimate a 14-day unique total.",
        "These metrics do not measure visits to the separate GitHub Pages website.",
        "Traffic is limited to GitHub's rolling 14-day window and UTC reporting.",
        "",
    ]
    return "\n".join(lines)


def write_files(snapshot: dict, output: Path) -> None:
    output.mkdir(parents=True, exist_ok=True)
    (output / "snapshot.json").write_text(
        json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    with (output / "daily.csv").open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(csv_rows(snapshot))
    (output / "report.md").write_text(render_report(snapshot), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True, help="owner/repository")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    actions_token = os.environ.get("GITHUB_TOKEN", "")
    traffic_token = os.environ.get("TEAMFORGE_TRAFFIC_READ_TOKEN", "")
    if not actions_token:
        parser.error("GITHUB_TOKEN is required for Actions counts")
    today = datetime.now(timezone.utc).date()
    snapshot = build_snapshot(
        args.repo, today, api_json,
        actions_token=actions_token, traffic_token=traffic_token,
    )
    write_files(snapshot, args.output)
    print(f"Saved three aggregated report files; trafficStatus={snapshot['trafficStatus']}")
    if not traffic_token:
        print("NOTICE: configure TEAMFORGE_TRAFFIC_READ_TOKEN for clone/view data.",
              file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
