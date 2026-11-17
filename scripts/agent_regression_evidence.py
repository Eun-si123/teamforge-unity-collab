#!/usr/bin/env python3
"""Execute only impacted, mapped Node regressions and record observed evidence.

This reads the repository-owned map as data, never executes command text from it.
It does NOT run Unity, physical two-PC, or release tests.
"""
import argparse
import datetime as dt
from hashlib import sha256
import json
from pathlib import Path
import subprocess
import sys
import time

from agent_feature_map import MAP, ROOT, git_diff, validate


def selected_tests(features, changed):
    changed = set(changed)
    return sorted({path for feature in features
                   if changed.intersection(feature["source"])
                   for path in feature["regressions"]})


def select_report(features, changed):
    files = selected_tests(features, changed)
    affected = sorted(f["id"] for f in features
                      if set(f["source"]).intersection(changed))
    return {"schemaVersion": 1, "features": affected, "regressions": files,
            "execution": "not-run", "fieldEvidence": "not-run"}


def run_one(path, timeout=120, executor=subprocess.run):
    # Test filenames come from validated relative repository paths, not shell.
    argv = ["node", "--test", "--test-reporter=spec", path]
    began = time.monotonic()
    try:
        completed = executor(argv, cwd=ROOT, stdin=subprocess.DEVNULL,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                             check=False, timeout=timeout)
        stdout, stderr = completed.stdout or b"", completed.stderr or b""
        return {"testFile": path, "argv": argv,
                "status": "passed" if completed.returncode == 0 else "failed",
                "exitCode": completed.returncode,
                "stdoutSha256": sha256(stdout).hexdigest(),
                "stderrSha256": sha256(stderr).hexdigest(),
                # Only hashes and exit status are retained; no test output or
                # possibly sensitive fixture contents appear in public reports.
                "seconds": round(time.monotonic() - began, 3)}
    except subprocess.TimeoutExpired as exc:
        return {"testFile": path, "argv": argv, "status": "failed",
                "error": "timeout", "seconds": round(time.monotonic() - began, 3)}
    except OSError as exc:
        return {"testFile": path, "argv": argv, "status": "failed",
                "error": type(exc).__name__,
                "seconds": round(time.monotonic() - began, 3)}


def source_state():
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT,
                                     text=True, timeout=10).strip()
    dirty = subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=no"],
                                    cwd=ROOT, text=True, timeout=10).strip()
    return commit, not bool(dirty)


def build_receipt(features, changed, *, runner=run_one, state=source_state):
    selected = select_report(features, changed)
    commit, clean = state()
    results = [runner(path) for path in selected["regressions"]]
    if not selected["regressions"]:
        status = "not-applicable"
    elif not clean:
        status = "incomplete"
    else:
        status = "passed" if all(row["status"] == "passed" for row in results) else "failed"
    return {"schemaVersion": 1, "sourceCommit": commit, "trackedClean": clean,
            "collectedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
            "features": selected["features"], "tests": results,
            "status": status, "fieldEvidence": "not-run",
            "limitation": "Only mapped Node tests actually executed. No Unity/physical release claim."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("select", "run"))
    parser.add_argument("--base", required=True)
    parser.add_argument("--head", required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--timeout", type=int, default=120)
    args = parser.parse_args()
    try:
        features = validate(json.loads(MAP.read_text(encoding="utf-8")))
        changed = git_diff(args.base, args.head)
        if args.action == "select":
            report = select_report(features, changed)
        else:
            if args.timeout < 1 or args.timeout > 600:
                raise ValueError("test timeout must be 1-600 seconds")
            report = build_receipt(features, changed,
                                   runner=lambda path: run_one(path, args.timeout))
        output = json.dumps(report, indent=2, ensure_ascii=False) + "\n"
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(output, encoding="utf-8")
        print(output, end="")
        if args.action == "run":
            return {"passed": 0, "not-applicable": 0, "failed": 1,
                    "incomplete": 2}[report["status"]]
        return 0
    except (OSError, ValueError, json.JSONDecodeError,
            subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        print("agent-regression-evidence:", exc, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
