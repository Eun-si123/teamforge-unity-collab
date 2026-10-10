#!/usr/bin/env python3
"""Record independently reviewed agent trials and compare matched experiments.

This tool does not launch agents or verify human attestations cryptographically.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys

from agent_evals import MANIFEST, evidence_status, validate

SHA = re.compile(r"^[a-f0-9]{40}$")
NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")
VERDICTS = {"passed", "failed", "not_checked"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def load_json(path):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    require(isinstance(data, dict), "JSON must contain an object")
    return data


def check_run(report, case):
    require(report.get("schemaVersion") == 1 and report.get("caseId") == case["id"],
            "runner schema/case mismatch")
    require(isinstance(report.get("sourceCommit"), str) and SHA.fullmatch(report["sourceCommit"]),
            "missing valid runner source commit")
    actual, expected = report.get("steps"), case["steps"]
    require(isinstance(actual, list) and len(actual) == len(expected),
            "runner steps missing or reordered")
    for row, spec in zip(actual, expected):
        require(isinstance(row, dict) and row.get("id") == spec["id"] and
                row.get("kind") == spec["kind"], "runner step identity mismatch")
        if spec["kind"] == "command":
            require(row.get("argv") == spec["argv"], "runner executed unexpected argv")
            rc = row.get("exitCode")
            if rc is not None:
                require(type(rc) is int and row.get("status") ==
                        ("passed" if rc == 0 else "failed"), "command exit/status contradiction")
            else:
                require(row.get("status") == "failed" and row.get("error") in
                        ("timeout", "FileNotFoundError", "PermissionError", "OSError"),
                        "missing executable exit evidence")
        else:
            require(row.get("status") == "incomplete" and
                    row.get("reference") == spec["reference"], "manual/external step was upgraded")
    require(report.get("evidenceStatus") == evidence_status(actual),
            "runner summary contradicts step results")


def blank_criterion(text):
    return {"criterion": text, "status": "not_checked", "evidence": ""}


def make_template(report, report_bytes, case, args):
    for key in ("variant", "trial_id", "environment", "agent", "reviewer"):
        require(bool(NAME.fullmatch(getattr(args, key))), "invalid " + key)
    require(args.agent != args.reviewer, "reviewer must be distinct from agent")
    require(bool(SHA.fullmatch(args.starting_commit)), "starting commit must be full Git SHA")
    return {
        "schemaVersion": 1, "caseId": case["id"], "runSha256": digest(report_bytes),
        "trialId": args.trial_id, "variant": args.variant,
        "startingCommit": args.starting_commit, "environment": args.environment,
        "agent": args.agent, "reviewer": args.reviewer,
        "agentWallSeconds": None, "humanMinutes": None, "costUsd": None,
        "acceptance": [blank_criterion(x) for x in case["acceptance"]],
        "regressions": [blank_criterion(x) for x in case["regressions"]],
        "externalSteps": [{"id": x["id"], "status": "not_checked", "evidence": ""}
                          for x in case["steps"] if x["kind"] != "command"],
    }


def positive_metric(review, field):
    value = review.get(field)
    require(value is None or
            (type(value) in (int, float) and 0 <= value < 1e12),
            field + " must be a nonnegative finite number or null")
    return value


def check_verdicts(provided, expected, key):
    require(isinstance(provided, list) and len(provided) == len(expected),
            key + " criterion count mismatch")
    for item, title in zip(provided, expected):
        require(isinstance(item, dict) and item.get("criterion" if key != "externalSteps" else "id") == title,
                key + " criterion/order mismatch")
        require(item.get("status") in VERDICTS, key + " invalid verdict")
        evidence = item.get("evidence")
        require(isinstance(evidence, str), key + " evidence must be text")
        if item["status"] != "not_checked":
            require(bool(evidence.strip()), key + " checked verdict needs evidence")
    return [item["status"] for item in provided]


def assess(report, run_bytes, review, case):
    check_run(report, case)
    require(review.get("schemaVersion") == 1 and review.get("caseId") == case["id"],
            "review schema/case mismatch")
    require(review.get("runSha256") == digest(run_bytes), "review is not bound to runner report")
    for name in ("trialId", "variant", "environment", "agent", "reviewer"):
        require(isinstance(review.get(name), str) and NAME.fullmatch(review[name]),
                "invalid review field: " + name)
    require(review["agent"] != review["reviewer"], "self-review is not independent")
    require(isinstance(review.get("startingCommit"), str) and
            SHA.fullmatch(review["startingCommit"]), "invalid starting commit")
    metrics = {k: positive_metric(review, k)
               for k in ("agentWallSeconds", "humanMinutes", "costUsd")}
    verdicts = []
    verdicts.extend(check_verdicts(review.get("acceptance"), case["acceptance"], "acceptance"))
    verdicts.extend(check_verdicts(review.get("regressions"), case["regressions"], "regressions"))
    verdicts.extend(check_verdicts(review.get("externalSteps"),
                    [x["id"] for x in case["steps"] if x["kind"] != "command"], "externalSteps"))
    command_failed = any(x["status"] == "failed" for x in report["steps"])
    if command_failed or "failed" in verdicts:
        outcome = "failed"
    elif "not_checked" in verdicts or any(x["status"] == "incomplete" for x in report["steps"]
                                          if x["kind"] == "command"):
        outcome = "incomplete"
    else:
        outcome = "review-attested-pass"
    return {
        "schemaVersion": 1, "caseId": case["id"], "caseSha256": digest(canonical(case)),
        "trialId": review["trialId"], "variant": review["variant"],
        "startingCommit": review["startingCommit"], "evaluatedCommit": report["sourceCommit"],
        "environment": review["environment"], "reviewer": review["reviewer"],
        "runSha256": digest(run_bytes), "automatedStatus": report["evidenceStatus"],
        "reviewedOutcome": outcome, **metrics,
        "limitation": "Reviewer evidence is an attestation, NOT cryptographic proof or a physical-test substitute."
    }


def compare(records):
    require(len(records) >= 2, "at least two reviewed trials needed")
    for r in records:
        require(r.get("schemaVersion") == 1 and
                r.get("reviewedOutcome") in ("failed", "incomplete", "review-attested-pass"),
                "not a validated assessment")
        for key in ("caseId", "caseSha256", "startingCommit", "environment", "variant", "trialId"):
            require(isinstance(r.get(key), str) and bool(r[key]), "missing " + key)
    invariant = ("caseId", "caseSha256", "startingCommit", "environment")
    for key in invariant:
        require(len({r[key] for r in records}) == 1, "unmatched " + key + " across trials")
    require(len({r["trialId"] for r in records}) == len(records), "duplicate trial ID")
    variants = sorted({r["variant"] for r in records})
    require(len(variants) == 2, "comparison needs exactly two variants")
    groups = {}
    for variant in variants:
        items = [r for r in records if r["variant"] == variant]
        groups[variant] = {
            "attempts": len(items),
            "reviewAttestedPass": sum(r["reviewedOutcome"] == "review-attested-pass" for r in items),
            "failed": sum(r["reviewedOutcome"] == "failed" for r in items),
            "incomplete": sum(r["reviewedOutcome"] == "incomplete" for r in items),
            "medianAgentWallSeconds": median([r.get("agentWallSeconds") for r in items]),
            "medianHumanMinutes": median([r.get("humanMinutes") for r in items]),
            "medianCostUsd": median([r.get("costUsd") for r in items]),
        }
    enough = all(v["attempts"] >= 3 and v["incomplete"] == 0 for v in groups.values())
    return {
        "schemaVersion": 1, "caseId": records[0]["caseId"],
        "startingCommit": records[0]["startingCommit"], "environment": records[0]["environment"],
        "evaluation": "descriptive-only" if enough else "insufficient-matched-complete-trials",
        "variants": groups,
        "warning": "Not a causal productivity claim. Reviewer attestations and time/cost inputs require independent verification; use multiple tasks and trials before making decisions."
    }


def median(values):
    vals = sorted(x for x in values if type(x) in (int, float) and x >= 0)
    if not vals:
        return None
    midpoint = len(vals) // 2
    return vals[midpoint] if len(vals) % 2 else (vals[midpoint - 1] + vals[midpoint]) / 2


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    template = sub.add_parser("template")
    template.add_argument("run_report")
    for option in ("starting-commit", "variant", "trial-id", "environment", "agent", "reviewer"):
        template.add_argument("--" + option, required=True)
    assess_cmd = sub.add_parser("assess")
    assess_cmd.add_argument("run_report")
    assess_cmd.add_argument("review")
    compare_cmd = sub.add_parser("compare")
    compare_cmd.add_argument("assessments", nargs="+")
    for cmd in (template, assess_cmd, compare_cmd):
        cmd.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        cases = validate(load_json(MANIFEST))
        if args.action == "compare":
            result = compare([load_json(p) for p in args.assessments])
        else:
            raw = Path(args.run_report).read_bytes()
            report = json.loads(raw)
            require(isinstance(report, dict) and report.get("caseId") in cases,
                    "unknown runner case")
            case = cases[report["caseId"]]
            check_run(report, case)
            result = (make_template(report, raw, case, args) if args.action == "template" else
                      assess(report, raw, load_json(args.review), case))
        output = json.dumps(result, indent=2, ensure_ascii=False) + "\n"
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(output, encoding="utf-8")
        else:
            sys.stdout.write(output)
        return 0
    except (OSError, ValueError, json.JSONDecodeError, TypeError) as error:
        print("agent-eval-trials:", error, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
