#!/usr/bin/env python3
"""Explicit, non-daemon CLI for live repository context and atomic local leases."""
import argparse
import json
import os
import sys
from core import Store, ControlError, PROJECTS
from github_live import LiveGitHub


def token_env():
    token = os.environ.get("AGENT_LEASE_TOKEN", "")
    if not token:
        raise ControlError("Set AGENT_LEASE_TOKEN in your private process environment (never CLI/logs).")
    return token


def parser():
    p = argparse.ArgumentParser(description="Local TeamForge/BetterNet/DataNetShare agent control plane")
    p.add_argument("--db", default=None, help="Private SQLite file on a mounted HDD.")
    subs = p.add_subparsers(dest="command", required=True)
    for name in ("status", "next-tasks", "progress"):
        s = subs.add_parser(name)
        s.add_argument("--project", choices=[*PROJECTS], required=False)
        s.add_argument("--all", action="store_true")
    s = subs.add_parser("task-context")
    s.add_argument("--project", choices=[*PROJECTS], required=True)
    s.add_argument("--issue", type=int, required=True)
    s = subs.add_parser("checkpoint")
    s.add_argument("--project", choices=[*PROJECTS], required=True)
    s.add_argument("--task", required=True)
    s = subs.add_parser("lease-acquire")
    lease_identity(s)
    s.add_argument("--actor", required=True)
    s.add_argument("--branch", required=True)
    s.add_argument("--surface", action="append", required=True,
                   help="Repeated repository-relative file or directory ending with '/'.")
    s.add_argument("--ttl", type=int, default=1800)
    s = subs.add_parser("lease-renew")
    lease_identity(s)
    s.add_argument("--fence", type=int, required=True)
    s.add_argument("--ttl", type=int, default=1800)
    s = subs.add_parser("save-checkpoint")
    lease_identity(s)
    s.add_argument("--fence", type=int, required=True)
    s.add_argument("--head", required=True)
    s.add_argument("--test", action="append", default=[])
    s.add_argument("--next", required=True)
    s.add_argument("--blocker", default="")
    s = subs.add_parser("lease-release")
    lease_identity(s)
    s.add_argument("--fence", type=int, required=True)
    s = subs.add_parser("lease-recover")
    lease_identity(s)
    s.add_argument("--actor", required=True)
    s.add_argument("--branch", required=True)
    s.add_argument("--old-fence", type=int, required=True)
    s.add_argument("--expected-head", required=True)
    s.add_argument("--ttl", type=int, default=1800)
    s.add_argument("--confirm-inspected", action="store_true",
                   help="Assert you inspected the exact live branch, PR and saved checkpoint.")
    return p


def lease_identity(sub):
    sub.add_argument("--project", choices=[*PROJECTS], required=True)
    sub.add_argument("--task", required=True)


def execute(a, *, live=None, store=None):
    live = live or LiveGitHub()
    store = store or Store(a.db)
    if a.command in ("status", "next-tasks", "progress"):
        if bool(a.project) == bool(a.all):
            raise ControlError("Choose exactly one of --project or --all.")
        projects = [a.project] if a.project else list(PROJECTS)
        result = {}
        for project in projects:
            if a.command == "status":
                result[project] = live.status(project)
            elif a.command == "next-tasks":
                result[project] = live.next_tasks(project, store)
            else:
                result[project] = {"project": project, "localLeases": store.progress(project),
                                   "github": live.status(project)}
        return result[projects[0]] if a.project else result
    if a.command == "task-context":
        return live.task_context(a.project, a.issue)
    if a.command == "checkpoint":
        return live.checkpoint_and_ref(a.project, a.task, store)
    if a.command == "lease-acquire":
        return store.acquire(a.project, a.task, a.actor, a.branch, a.surface, a.ttl)
    if a.command == "lease-renew":
        return store.renew(a.project, a.task, token_env(), a.fence, a.ttl)
    if a.command == "save-checkpoint":
        return store.checkpoint(a.project, a.task, token_env(), a.fence,
                                a.head, a.test, a.next, a.blocker)
    if a.command == "lease-release":
        return store.release(a.project, a.task, token_env(), a.fence)
    if a.command == "lease-recover":
        if not a.confirm_inspected:
            raise ControlError("Recovery requires --confirm-inspected after checking live GitHub and checkpoint.")
        cp = live.checkpoint_and_ref(a.project, a.task, store)
        if cp.get("checkpointMatchesBranchHead") is not True:
            raise ControlError("GitHub branch HEAD disagrees with last checkpoint; refusing takeover.")
        if cp["checkpoint"]["head_sha"] != a.expected_head:
            raise ControlError("Expected head differs from stored checkpoint.")
        return store.recover(a.project, a.task, a.actor, a.old_fence,
                             a.expected_head, a.branch, a.ttl)
    raise ControlError("Unexpected command.")


def main(argv=None):
    a = parser().parse_args(argv)
    try:
        output = execute(a)
        print(json.dumps(output, ensure_ascii=False, indent=2))
        return 0
    except ControlError as error:
        # Never print API/credential details, malformed data or SQLite internals.
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())

