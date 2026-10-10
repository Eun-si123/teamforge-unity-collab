#!/usr/bin/env python3
"""Run existing checks against historical coding-agent tasks without grading agent self-reports."""
import argparse
import datetime as dt
import json
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "agent-evals" / "cases.json"

def inside(root, relative):
    if not isinstance(relative, str) or not relative or Path(relative).is_absolute():
        raise ValueError("expected nonempty relative path")
    dest = (root / relative).resolve()
    if not dest.is_relative_to(root.resolve()):
        raise ValueError("path escapes repository: " + relative)
    return dest

def validate(doc, root=ROOT):
    if not isinstance(doc, dict) or doc.get("schemaVersion") != 1:
        raise ValueError("invalid schemaVersion")
    items = doc.get("cases")
    if not isinstance(items, list) or not items:
        raise ValueError("nonempty cases list required")
    cases = {}
    for case in items:
        if not isinstance(case, dict):
            raise ValueError("case must be object")
        cid = case.get("id")
        if not isinstance(cid, str) or not cid or not all(c.islower() or c.isdigit() or c == "-" for c in cid):
            raise ValueError("invalid case ID")
        if cid in cases:
            raise ValueError("duplicate case ID: " + cid)
        for field in ("title", "task", "source"):
            if not isinstance(case.get(field), str) or not case[field].strip():
                raise ValueError(cid + ": missing " + field)
        for field in ("acceptance", "regressions"):
            v = case.get(field)
            if not isinstance(v, list) or not v or any(not isinstance(x, str) or not x.strip() for x in v):
                raise ValueError(cid + ": invalid " + field)
        steps = case.get("steps")
        if not isinstance(steps, list) or not steps:
            raise ValueError(cid + ": missing evidence steps")
        seen = set()
        for step in steps:
            if not isinstance(step, dict) or step.get("kind") not in ("command", "manual", "external"):
                raise ValueError(cid + ": invalid evidence kind")
            sid = step.get("id")
            if not isinstance(sid, str) or not sid or sid in seen:
                raise ValueError(cid + ": missing/duplicate evidence id")
            seen.add(sid)
            if step["kind"] == "command":
                cmd = step.get("argv")
                if not isinstance(cmd, list) or not cmd or any(not isinstance(s, str) or not s for s in cmd):
                    raise ValueError(cid + ": invalid argv")
                if not inside(root, step.get("cwd", ".")).is_dir():
                    raise ValueError(cid + ": missing cwd")
            else:
                if not inside(root, step.get("reference")).is_file():
                    raise ValueError(cid + ": missing evidence reference")
                if not isinstance(step.get("reason"), str) or not step["reason"].strip():
                    raise ValueError(cid + ": missing evidence reason")
        cases[cid] = case
    return cases

def evidence_status(steps):
    if any(s.get("status") == "failed" for s in steps):
        return "failed"
    if not steps or any(s.get("status") != "passed" for s in steps):
        return "incomplete"
    return "passed"

def git_sha():
    try:
        return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True, stderr=subprocess.DEVNULL, timeout=4).strip()
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return None

def run_case(case, label, timeout):
    steps, started = [], time.monotonic()
    for step in case["steps"]:
        row = {"id": step["id"], "kind": step["kind"]}
        if step["kind"] != "command":
            row.update(status="incomplete", reference=step["reference"], reason=step["reason"])
        else:
            begin = time.monotonic()
            try:
                completed = subprocess.run(step["argv"], cwd=inside(ROOT, step.get("cwd", ".")),
                                           stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                           stderr=subprocess.DEVNULL, timeout=timeout, check=False)
                row.update(status="passed" if completed.returncode == 0 else "failed",
                           exitCode=completed.returncode)
            except subprocess.TimeoutExpired:
                row.update(status="failed", error="timeout")
            except OSError as exc:
                row.update(status="failed", error=type(exc).__name__)
            row["seconds"] = round(time.monotonic() - begin, 3)
            row["argv"] = step["argv"]
        steps.append(row)
    return {"schemaVersion": 1, "caseId": case["id"], "label": label,
            "collectedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "sourceCommit": git_sha(),
            "evidenceStatus": evidence_status(steps), "elapsedSeconds": round(time.monotonic() - started, 3),
            "steps": steps,
            "limitation": "Checks alone do not establish agent productivity or unexecuted field evidence."}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("validate", "list", "plan", "run", "compare"))
    parser.add_argument("values", nargs="*")
    parser.add_argument("--label", default="unlabelled")
    parser.add_argument("--timeout", type=int, default=900)
    parser.add_argument("--output", type=Path)
    a = parser.parse_args()
    try:
        cases = validate(json.loads(MANIFEST.read_text(encoding="utf-8")))
        if a.action == "validate":
            print("Validated", len(cases), "evaluation cases")
        elif a.action == "list":
            for case in cases.values():
                print(case["id"] + ": " + case["title"])
        elif a.action == "compare":
            if len(a.values) != 2:
                parser.error("compare requires two report files")
            records = [json.loads(Path(p).read_text(encoding="utf-8")) for p in a.values]
            if records[0].get("caseId") != records[1].get("caseId") or records[0].get("caseId") not in cases:
                raise ValueError("reports must use the same known case")
            for record in records:
                if record.get("schemaVersion") != 1 or record.get("evidenceStatus") != evidence_status(record.get("steps", [])):
                    raise ValueError("inconsistent evidence result")
            print(json.dumps({"caseId": records[0]["caseId"],
                              "results": [{"label": r.get("label"), "status": r["evidenceStatus"],
                                           "seconds": r.get("elapsedSeconds")} for r in records],
                              "warning": "Comparable agent evaluations also require matched starts, repeated trials, and independent acceptance checks."}, indent=2))
        else:
            if len(a.values) != 1 or a.values[0] not in cases:
                parser.error("plan/run requires a case ID from list")
            case = cases[a.values[0]]
            if a.action == "plan":
                print(json.dumps(case, indent=2))
            else:
                if a.timeout < 1:
                    raise ValueError("timeout must be positive")
                result = run_case(case, a.label, a.timeout)
                output = json.dumps(result, indent=2) + "\n"
                if a.output:
                    a.output.parent.mkdir(parents=True, exist_ok=True)
                    a.output.write_text(output, encoding="utf-8")
                print(output, end="")
                return {"passed": 0, "failed": 1, "incomplete": 2}[result["evidenceStatus"]]
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print("agent-evals:", exc, file=sys.stderr)
        return 1
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
