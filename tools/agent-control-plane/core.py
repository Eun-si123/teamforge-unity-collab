"""Local, transactional agent task leases and interruption-safe checkpoints.

Private local SQLite state is NEVER published to GitHub. Source uses Python stdlib.
A lease coordinates clients pointing to THIS database only; it is not a GitHub lock.
"""
from __future__ import annotations

import json
from contextlib import contextmanager
import os
import re
import secrets
import sqlite3
import time
from pathlib import Path

PROJECTS = {
    "TeamForge": "Eun-si123/teamforge-unity-collab",
    "BetterNet": None,  # Private repository locator is host-only configuration.
    "DataNetShare": "Eun-si123/DataNetShare",
}
DEFAULT_DB = "/mnt/storage/agent-control-plane/state/agent-queue.sqlite3"
TASK_RE = re.compile(r"(?:#[1-9][0-9]{0,8}|[a-z][a-z0-9-]{2,63})\Z")
ACTOR_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{1,79}\Z")
BRANCH_RE = re.compile(r"agent/[A-Za-z0-9._/-]{3,110}\Z")
HEAD_RE = re.compile(r"[0-9a-f]{40}\Z")
MAX_LEASE_SEC = 3600


class ControlError(ValueError):
    pass


def require_project(project: str) -> str:
    if project not in PROJECTS:
        raise ControlError("Unknown project. Choose TeamForge, BetterNet or DataNetShare.")
    return project


def repository_for(project: str) -> str:
    project = require_project(project)
    public = PROJECTS[project]
    if public is not None:
        return public
    # Never commit private repository locators or secrets into the public repo.
    config_path = Path(os.environ.get(
        "AGENT_CONTROL_PRIVATE_CONFIG",
        "/mnt/storage/agent-control-plane/state/private-repos.json"
    ))
    if config_path.is_symlink() or not config_path.is_file():
        raise ControlError("Private project mapping missing or unsafe; configure it on the host.")
    if config_path.stat().st_mode & 0o077:
        raise ControlError("Private project mapping must have owner-only permissions.")
    try:
        config = json.loads(config_path.read_text(encoding="utf-8"))
    except (ValueError, OSError) as exc:
        raise ControlError("Private project mapping unreadable.") from exc
    repo = config.get(project)
    if not isinstance(repo, str) or not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo):
        raise ControlError("Private project mapping invalid.")
    return repo


def require_task(task: str) -> str:
    if not isinstance(task, str) or not TASK_RE.fullmatch(task):
        raise ControlError("Task must be a GitHub issue like #303 or a safe descriptive slug.")
    return task


def require_actor(actor: str) -> str:
    if not isinstance(actor, str) or not ACTOR_RE.fullmatch(actor):
        raise ControlError("Invalid agent identifier.")
    return actor


def require_branch(branch: str) -> str:
    if not isinstance(branch, str) or not BRANCH_RE.fullmatch(branch) or ".." in branch or "//" in branch:
        raise ControlError("Branch must be an agent/* ref without traversal.")
    return branch


def require_head(head: str) -> str:
    if not isinstance(head, str) or not HEAD_RE.fullmatch(head):
        raise ControlError("Expected a full 40-digit lowercase Git commit SHA.")
    return head


def normalize_surface(surface: str) -> str:
    if not isinstance(surface, str) or not (1 <= len(surface) <= 180):
        raise ControlError("Surface must be a nonempty repository-relative path.")
    if surface.startswith("/") or "\\" in surface or "\x00" in surface or "*" in surface:
        raise ControlError("No absolute, wildcard, Windows, or NUL resource paths.")
    is_directory = surface.endswith("/")
    elements = surface.rstrip("/").split("/")
    if any(e in ("", ".", "..") or not re.fullmatch(r"[A-Za-z0-9._@+-]+", e) for e in elements):
        raise ControlError("Unsafe or ambiguous repository-relative resource.")
    return "/".join(elements) + ("/" if is_directory else "")


def overlaps(left: str, right: str) -> bool:
    if left == right:
        return True
    return (left.endswith("/") and right.startswith(left)) or (
        right.endswith("/") and left.startswith(right)
    )


def validated_surfaces(surfaces: list[str]) -> list[str]:
    if not isinstance(surfaces, list) or not (1 <= len(surfaces) <= 20):
        raise ControlError("Claim 1–20 explicit source resource paths.")
    result = sorted(set(normalize_surface(s) for s in surfaces))
    if any(overlaps(a, b) for i, a in enumerate(result) for b in result[i + 1:]):
        raise ControlError("Overlapping surfaces within a single claim are ambiguous.")
    return result


class Store:
    def __init__(self, path: str | None = None, *, clock=None):
        self.path = Path(path or os.environ.get("AGENT_CONTROL_DB", DEFAULT_DB))
        self.clock = clock or time.time
        if (str(self.path).startswith("/mnt/storage/") and
                not os.path.ismount("/mnt/storage")):
            raise ControlError("HDD /mnt/storage is not mounted; refusing NVMe fallback.")
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        if self.path.parent.stat().st_mode & 0o077:
            raise ControlError("Control-plane DB directory must not be group/world accessible.")
        if self.path.is_symlink():
            raise ControlError("Refusing SQLite symlink.")
        if self.path.exists() and self.path.stat().st_mode & 0o077:
            raise ControlError("Existing SQLite DB file is not owner-private.")
        conn = self.connect()
        try:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS leases(
                    project TEXT NOT NULL, task TEXT NOT NULL,
                    actor TEXT NOT NULL, branch TEXT NOT NULL, token TEXT,
                    fence INTEGER NOT NULL, state TEXT NOT NULL,
                    expires_at REAL NOT NULL, updated_at REAL NOT NULL,
                    PRIMARY KEY(project,task)
                );
                CREATE TABLE IF NOT EXISTS surfaces(
                    project TEXT NOT NULL, task TEXT NOT NULL, resource TEXT NOT NULL,
                    PRIMARY KEY(project,task,resource),
                    FOREIGN KEY(project,task) REFERENCES leases(project,task)
                );
                CREATE TABLE IF NOT EXISTS checkpoints(
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    project TEXT NOT NULL, task TEXT NOT NULL,
                    fence INTEGER NOT NULL, actor TEXT NOT NULL,
                    branch TEXT NOT NULL, head_sha TEXT NOT NULL,
                    test_summary TEXT NOT NULL, blocker TEXT NOT NULL,
                    next_step TEXT NOT NULL, saved_at REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS checkpoint_by_task
                    ON checkpoints(project,task,id DESC);
            """)
        finally:
            conn.close()
        os.chmod(self.path, 0o600)

    def connect(self):
        c = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA busy_timeout=10000")
        c.execute("PRAGMA foreign_keys=ON")
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA synchronous=FULL")
        return c

    @contextmanager
    def session(self):
        connection = self.connect()
        try:
            yield connection
        finally:
            connection.close()

    @staticmethod
    def _tx(c):
        c.execute("BEGIN IMMEDIATE")

    @staticmethod
    def _verify_lease(row, token: str, fence: int, now: float):
        if row is None or row["state"] != "active" or row["expires_at"] <= now:
            raise ControlError("Lease absent, expired, or released. No stale writes.")
        if not token or not secrets.compare_digest(str(row["token"] or ""), str(token)):
            raise ControlError("Lease capability token mismatch.")
        if row["fence"] != fence:
            raise ControlError("Stale fencing number. Refusing write.")

    def _lock_surfaces(self, c, project: str, task: str, surfaces: list[str]):
        claims = c.execute("""SELECT s.resource,l.task FROM surfaces s
            JOIN leases l ON l.project=s.project AND l.task=s.task
            WHERE s.project=? AND l.state='active' AND l.task<>?""",
            (project, task)).fetchall()
        for new in surfaces:
            for old in claims:
                if overlaps(new, old["resource"]):
                    raise ControlError("Resource overlap with another active/expired task. Check live owner.")
        c.execute("DELETE FROM surfaces WHERE project=? AND task=?", (project, task))
        c.executemany("INSERT INTO surfaces(project,task,resource) VALUES (?,?,?)",
                      [(project, task, item) for item in surfaces])

    def acquire(self, project, task, actor, branch, surfaces, ttl=1800):
        project, task = require_project(project), require_task(task)
        actor, branch = require_actor(actor), require_branch(branch)
        surface_list = validated_surfaces(surfaces)
        if isinstance(ttl, bool) or not isinstance(ttl, int) or not 60 <= ttl <= MAX_LEASE_SEC:
            raise ControlError("TTL must be 60–3600 seconds.")
        now = self.clock()
        token = secrets.token_urlsafe(36)
        with self.session() as c:
            self._tx(c)
            existing = c.execute("SELECT * FROM leases WHERE project=? AND task=?",
                                 (project, task)).fetchone()
            if existing and existing["state"] == "active":
                raise ControlError("Task already claimed or expired; explicit inspected recovery required.")
            fence = (existing["fence"] + 1) if existing else 1
            c.execute("""INSERT INTO leases(project,task,actor,branch,token,fence,state,expires_at,updated_at)
                VALUES(?,?,?,?,?,?,'active',?,?)
                ON CONFLICT(project,task) DO UPDATE SET
                    actor=excluded.actor,branch=excluded.branch,token=excluded.token,
                    fence=excluded.fence,state='active',
                    expires_at=excluded.expires_at,updated_at=excluded.updated_at""",
                (project, task, actor, branch, token, fence, now + ttl, now))
            self._lock_surfaces(c, project, task, surface_list)
            c.commit()
        return {"project": project, "task": task, "actor": actor, "branch": branch,
                "fence": fence, "token": token, "expiresAt": now + ttl, "surfaces": surface_list,
                "warning": "Secret token: do not print in CI logs or GitHub comments."}

    def renew(self, project, task, token, fence, ttl=1800):
        project, task = require_project(project), require_task(task)
        if not isinstance(ttl, int) or not 60 <= ttl <= MAX_LEASE_SEC:
            raise ControlError("Invalid TTL.")
        now = self.clock()
        with self.session() as c:
            self._tx(c)
            row = c.execute("SELECT * FROM leases WHERE project=? AND task=?", (project, task)).fetchone()
            self._verify_lease(row, token, fence, now)
            c.execute("UPDATE leases SET expires_at=?,updated_at=? WHERE project=? AND task=?",
                      (now + ttl, now, project, task))
            c.commit()
        return {"renewed": True, "fence": fence, "expiresAt": now + ttl}

    def checkpoint(self, project, task, token, fence, head, tests, next_step, blocker=""):
        project, task, head = require_project(project), require_task(task), require_head(head)
        if not isinstance(tests, list) or len(tests) > 30 or any(
            not isinstance(t, str) or len(t) > 150 for t in tests
        ):
            raise ControlError("Tests must be a list of up to 30 short status descriptions.")
        if not isinstance(next_step, str) or not 1 <= len(next_step) <= 1500:
            raise ControlError("Next safe step is required (max 1500 chars).")
        if not isinstance(blocker, str) or len(blocker) > 1500:
            raise ControlError("Blocker too long.")
        now = self.clock()
        with self.session() as c:
            self._tx(c)
            row = c.execute("SELECT * FROM leases WHERE project=? AND task=?", (project, task)).fetchone()
            self._verify_lease(row, token, fence, now)
            c.execute("""INSERT INTO checkpoints(project,task,fence,actor,branch,head_sha,
                test_summary,blocker,next_step,saved_at) VALUES(?,?,?,?,?,?,?,?,?,?)""",
                (project, task, fence, row["actor"], row["branch"], head,
                 json.dumps(tests, ensure_ascii=False), blocker, next_step, now))
            checkpoint_id = c.execute("SELECT last_insert_rowid()").fetchone()[0]
            c.commit()
        return {"checkpointId": checkpoint_id, "project": project, "task": task, "fence": fence}

    def last_checkpoint(self, project, task):
        project, task = require_project(project), require_task(task)
        with self.session() as c:
            row = c.execute("SELECT * FROM checkpoints WHERE project=? AND task=? ORDER BY id DESC LIMIT 1",
                            (project, task)).fetchone()
        if row is None:
            return None
        data = dict(row)
        data["tests"] = json.loads(data.pop("test_summary"))
        return data

    def recover(self, project, task, actor, old_fence, expected_head, branch, ttl=1800):
        """Compare-and-swap takeover only with a reviewed checkpoint identity.

        An expired lease does NOT automatically become free. External GitHub
        source/PR verification is operator responsibility before calling recover.
        """
        project, task = require_project(project), require_task(task)
        actor, branch = require_actor(actor), require_branch(branch)
        expected_head = require_head(expected_head)
        if isinstance(ttl, bool) or not isinstance(ttl, int) or not 60 <= ttl <= MAX_LEASE_SEC:
            raise ControlError("Invalid TTL.")
        now = self.clock()
        token = secrets.token_urlsafe(36)
        with self.session() as c:
            self._tx(c)
            row = c.execute("SELECT * FROM leases WHERE project=? AND task=?", (project, task)).fetchone()
            cp = c.execute("SELECT * FROM checkpoints WHERE project=? AND task=? ORDER BY id DESC LIMIT 1",
                           (project, task)).fetchone()
            if row is None or row["state"] != "active" or row["expires_at"] > now:
                raise ControlError("Recovery requires an expired, still-owned task.")
            if row["fence"] != old_fence or cp is None or cp["head_sha"] != expected_head:
                raise ControlError("Checkpoint/epoch mismatch; inspect GitHub source before recovery.")
            if cp["branch"] != branch:
                raise ControlError("Recovery must use the checkpoint's existing branch.")
            fence = row["fence"] + 1
            c.execute("""UPDATE leases SET actor=?,branch=?,token=?,fence=?,expires_at=?,updated_at=?
                WHERE project=? AND task=?""", (actor, branch, token, fence, now + ttl, now, project, task))
            c.commit()
        return {"recovered": True, "project": project, "task": task, "fence": fence,
                "token": token, "expiresAt": now + ttl,
                "warning": "Review actual GitHub HEAD and any uncommitted work before continuing."}

    def release(self, project, task, token, fence):
        project, task = require_project(project), require_task(task)
        now = self.clock()
        with self.session() as c:
            self._tx(c)
            row = c.execute("SELECT * FROM leases WHERE project=? AND task=?", (project, task)).fetchone()
            self._verify_lease(row, token, fence, now)
            c.execute("UPDATE leases SET state='released',token=NULL,updated_at=? WHERE project=? AND task=?",
                      (now, project, task))
            c.execute("DELETE FROM surfaces WHERE project=? AND task=?", (project, task))
            c.commit()
        return {"released": True, "project": project, "task": task, "fence": fence}

    def progress(self, project):
        project = require_project(project)
        now = self.clock()
        with self.session() as c:
            leases = c.execute("""SELECT project,task,actor,branch,fence,state,expires_at,updated_at
                FROM leases WHERE project=? ORDER BY updated_at DESC LIMIT 100""", (project,)).fetchall()
            rows = []
            for row in leases:
                item = dict(row)
                item["status"] = ("EXPIRED_NEEDS_REVIEW" if item.pop("state") == "active"
                                  and item["expires_at"] <= now else
                                  "ACTIVE" if row["state"] == "active" else "RELEASED")
                item["surfaces"] = [s[0] for s in c.execute(
                    "SELECT resource FROM surfaces WHERE project=? AND task=? ORDER BY resource",
                    (project, row["task"]))]
                item["lastCheckpoint"] = self.last_checkpoint(project, row["task"])
                rows.append(item)
        return rows

