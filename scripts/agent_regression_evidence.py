#!/usr/bin/env python3
"""Execute only impacted, mapped Node regressions and record observed evidence.

This reads the repository-owned map as data, never executes command text from it.
It does NOT run Unity, physical two-PC, or release tests.
"""
import argparse
import datetime as dt
from hashlib import sha256
import json
import os
import tempfile
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


# Observed process outcomes, not a diagnosis of the underlying product defect.
RECOVERY_HINTS = {
    "nonzero-exit": "Inspect the failing command and exact-source diagnostics before changing code or retrying.",
    "signal-termination": "Inspect cancellation, resource pressure and supervisor evidence before rerunning.",
    "timeout": "Inspect hangs, resource pressure and configured deadline; do not blindly increase the timeout.",
    "launch-unavailable": "Verify executable, permissions and working directory before restarting the suite.",
    "launch-error": "Investigate the execution environment error before retrying.",
}


def failure_fields(kind):
    return {"failureKind": kind, "recoveryHint": RECOVERY_HINTS[kind]} if kind else {}


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
                **failure_fields("signal-termination" if completed.returncode < 0
                                 else "nonzero-exit" if completed.returncode else None),
                "stdoutSha256": sha256(stdout).hexdigest(),
                "stderrSha256": sha256(stderr).hexdigest(),
                # Only hashes and exit status are retained; no test output or
                # possibly sensitive fixture contents appear in public reports.
                "seconds": round(time.monotonic() - began, 3)}
    except subprocess.TimeoutExpired as exc:
        return {"testFile": path, "argv": argv, "status": "failed",
                "error": "timeout", **failure_fields("timeout"), "seconds": round(time.monotonic() - began, 3)}
    except OSError as exc:
        return {"testFile": path, "argv": argv, "status": "failed",
                "error": type(exc).__name__,
                **failure_fields("launch-unavailable" if isinstance(exc, (FileNotFoundError, PermissionError))
                                 else "launch-error"),
                "seconds": round(time.monotonic() - began, 3)}


def source_state():
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT,
                                     text=True, timeout=10).strip()
    dirty = subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=no"],
                                    cwd=ROOT, text=True, timeout=10).strip()
    return commit, not bool(dirty)


def resolve_commit(ref, root=ROOT):
    return subprocess.check_output(
        ["git", "rev-parse", "--verify", "--end-of-options", ref + "^{commit}"],
        cwd=root, text=True, timeout=10).strip()


def checkout_matches(base, head, commit, root=ROOT):
    if commit == head:
        return True
    # pull_request Actions normally checks out a synthetic merge, not the PR head.
    parents = subprocess.check_output(
        ["git", "show", "-s", "--format=%P", commit, "--"],
        cwd=root, text=True, timeout=10).split()
    return parents == [base, head]


def write_report(path, report):
    """Replace a receipt atomically so readers never see half-written JSON."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8",
                                         dir=path.parent, prefix=".receipt-",
                                         delete=False) as stream:
            tmp = Path(stream.name)
            json.dump(report, stream, indent=2, ensure_ascii=False)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(tmp, path)
    finally:
        if tmp is not None:
            tmp.unlink(missing_ok=True)


def build_receipt(features, changed, *, runner=run_one, state=source_state,
                  source_matches=lambda commit: True, checkpoint=None):
    selected = select_report(features, changed)
    commit, clean = state()
    matches = source_matches(commit)
    results = []
    pending = list(selected["regressions"])
    report = {"schemaVersion": 1, "sourceCommit": commit, "sourceCommitAfter": None,
              "trackedClean": clean, "sourceStable": False,
              "checkoutMatchesSelection": matches,
              "collectedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
              "features": selected["features"], "status": "incomplete",
              "haltReason": "checkout-mismatch" if not matches else "dirty-source" if not clean else None,
              "fieldEvidence": "not-run",
              "limitation": "Only mapped Node tests actually executed; source state checked before and after, not isolated against transient edits. No Unity/physical release claim."}

    def snapshot():
        return {**report, "tests": list(results), "pendingTests": list(pending)}

    if checkpoint is not None:
        checkpoint(snapshot())
    after, clean_after = commit, clean
    stable = clean
    if matches and clean and pending:
        for path in selected["regressions"]:
            row = runner(path)
            results.append(row)
            pending.pop(0)
            after, clean_after = state()
            stable = commit == after and clean and clean_after
            if not stable:
                report["haltReason"] = "source-changed"
            elif row.get("failureKind") == "launch-unavailable":
                # All remaining invocations use the same Node executable/cwd.
                report["haltReason"] = "launch-unavailable"
            report.update(sourceCommitAfter=after, trackedClean=clean and clean_after)
            if checkpoint is not None:
                checkpoint(snapshot())
            if report["haltReason"] is not None:
                break
    else:
        after, clean_after = state()
        stable = commit == after and clean and clean_after
    if not matches or not stable:
        status = "incomplete"
    elif not selected["regressions"]:
        status = "not-applicable"
    else:
        status = "passed" if all(row["status"] == "passed" for row in results) else "failed"
    report.update(sourceCommitAfter=after, trackedClean=clean and clean_after,
                  sourceStable=stable, status=status)
    return snapshot()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("select", "run"))
    parser.add_argument("--base", required=True)
    parser.add_argument("--head", required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--timeout", type=int, default=120)
    args = parser.parse_args()
    try:
        # Invalidate an old successful receipt before any new run can fail.
        if args.action == "run" and args.output:
            write_report(args.output, {"schemaVersion": 1, "status": "incomplete",
                                       "sourceCommit": None, "tests": [],
                                       "fieldEvidence": "not-run",
                                       "limitation": "New execution has not established source or test evidence."})
        features = validate(json.loads(MAP.read_text(encoding="utf-8")))
        # Pin both refs once; the requested diff and checkout validation use the same IDs.
        base, head = resolve_commit(args.base), resolve_commit(args.head)
        changed = git_diff(base, head)
        if args.action == "select":
            report = select_report(features, changed)
        else:
            if args.timeout < 1 or args.timeout > 600:
                raise ValueError("test timeout must be 1-600 seconds")
            report = build_receipt(features, changed,
                                   runner=lambda path: run_one(path, args.timeout),
                                   source_matches=lambda commit: checkout_matches(base, head, commit),
                                   checkpoint=(lambda row: write_report(
                                       args.output, {**row, "selectionBase": base, "selectionHead": head}))
                                   if args.output else None)
            report.update(selectionBase=base, selectionHead=head)
        output = json.dumps(report, indent=2, ensure_ascii=False) + "\n"
        if args.output:
            write_report(args.output, report)
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
