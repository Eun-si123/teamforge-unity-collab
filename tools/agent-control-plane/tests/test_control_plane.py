"""Deterministic SQLite CAS, recovery, GitHub lookup and MCP contract tests."""
import concurrent.futures
import io
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from core import ControlError, Store, overlaps, normalize_surface, repository_for
from github_live import LiveGitHub
from mcp_stdio import handle

HEAD_A = "a" * 40
HEAD_B = "b" * 40


class StoreTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.time = 1000.0
        self.path = str(Path(self.tmp.name, "private", "state.db"))
        self.store = Store(self.path, clock=lambda: self.time)

    def claim(self, task="#303", actor="runner-one", branch="agent/wp6-components",
              paths=None, ttl=1800):
        return self.store.acquire("TeamForge", task, actor, branch, paths or ["server/"], ttl)

    def test_acquire_renew_and_release_with_fence(self):
        a = self.claim()
        self.assertEqual(a["fence"], 1)
        self.assertEqual(a["surfaces"], ["server/"])
        with self.assertRaises(ControlError):
            self.claim()
        with self.assertRaises(ControlError):
            self.store.renew("TeamForge", "#303", "bad", a["fence"])
        self.time += 20
        renewed = self.store.renew("TeamForge", "#303", a["token"], a["fence"], 60)
        self.assertEqual(renewed["expiresAt"], 1080.0)
        self.assertTrue(self.store.release("TeamForge", "#303", a["token"], a["fence"])["released"])
        with self.assertRaises(ControlError):
            self.store.checkpoint("TeamForge", "#303", a["token"], a["fence"], HEAD_A, [], "next")
        b = self.claim()
        self.assertEqual(b["fence"], 2)
        self.assertNotEqual(a["token"], b["token"])
        self.assertEqual(os.stat(self.path).st_mode & 0o777, 0o600)

    def test_overlaps_use_directory_boundaries(self):
        a = self.claim(paths=["server/src/"])
        with self.assertRaises(ControlError):
            self.claim("#304", paths=["server/src/component.mjs"])
        with self.assertRaises(ControlError):
            self.claim("#304", paths=["server/"])
        other = self.claim("#304", paths=["server-test/"])
        self.assertNotEqual(other["task"], a["task"])
        # Different projects are independent despite same source names.
        betternet = self.store.acquire("BetterNet", "#303", "runner-two", "agent/another-branch", ["server/src/"])
        self.assertEqual(betternet["project"], "BetterNet")
        self.assertFalse(overlaps("server/", "server-test/"))

    def test_unsafe_resource_paths_fail_closed(self):
        for path in ["../passwd", "/root", "src//x", "src/./x", "src\\file", "*/", "a/../b", "a b"]:
            with self.subTest(path=path):
                with self.assertRaises(ControlError):
                    normalize_surface(path)
        with self.assertRaises(ControlError):
            self.claim(paths=["server/", "server/src/"])

    def test_expired_task_requires_inspected_recovery(self):
        a = self.claim(ttl=60)
        self.store.checkpoint("TeamForge", "#303", a["token"], a["fence"],
                              HEAD_A, ["unit PASS", "field NOT RUN"], "Review next source file")
        self.time += 61
        with self.assertRaises(ControlError):
            self.claim()
        with self.assertRaises(ControlError):
            self.claim("#304", paths=["server/x.mjs"])
        with self.assertRaises(ControlError):
            self.store.renew("TeamForge", "#303", a["token"], a["fence"])
        with self.assertRaises(ControlError):
            self.store.checkpoint("TeamForge", "#303", a["token"], a["fence"], HEAD_B, [], "oops")
        with self.assertRaises(ControlError):
            self.store.recover("TeamForge", "#303", "runner-two", 1, HEAD_B, "agent/wp6-components")
        with self.assertRaises(ControlError):
            self.store.recover("TeamForge", "#303", "runner-two", 2, HEAD_A, "agent/wp6-components")
        with self.assertRaises(ControlError):
            self.store.recover("TeamForge", "#303", "runner-two", 1, HEAD_A, "agent/other-branch")
        b = self.store.recover("TeamForge", "#303", "runner-two", 1, HEAD_A, "agent/wp6-components")
        self.assertEqual(b["fence"], 2)
        self.assertNotEqual(a["token"], b["token"])
        with self.assertRaises(ControlError):
            self.store.release("TeamForge", "#303", a["token"], 1)
        self.assertEqual(self.store.last_checkpoint("TeamForge", "#303")["next_step"],
                         "Review next source file")
        self.assertEqual(self.store.progress("TeamForge")[0]["status"], "ACTIVE")

    def test_checkpoint_history_and_private_fields(self):
        a = self.claim()
        x = self.store.checkpoint("TeamForge", "#303", a["token"], 1, HEAD_A, ["pytest PASS"], "next")
        y = self.store.checkpoint("TeamForge", "#303", a["token"], 1, HEAD_B, [], "next2", "needs review")
        self.assertLess(x["checkpointId"], y["checkpointId"])
        progress = self.store.progress("TeamForge")
        self.assertEqual(progress[0]["lastCheckpoint"]["head_sha"], HEAD_B)
        self.assertNotIn("token", repr(progress))
        with self.assertRaises(ControlError):
            self.store.checkpoint("TeamForge", "#303", a["token"], 1, "badsha", [], "next")

    def test_concurrent_independent_connections_one_winner(self):
        barrier = threading.Barrier(8)
        def worker(i):
            independent = Store(self.path, clock=lambda: self.time)
            barrier.wait(timeout=10)
            try:
                result = independent.acquire("TeamForge", "#310",
                    "runner-" + str(i), "agent/parallel-worker-" + str(i), ["server/src/"])
                return ("winner", result["fence"])
            except ControlError:
                return ("rejected", None)
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            outcomes = list(pool.map(worker, range(8)))
        self.assertEqual(sum(x[0] == "winner" for x in outcomes), 1)
        self.assertEqual(sum(x[0] == "rejected" for x in outcomes), 7)

    def test_independent_processes_observe_one_transaction_winner(self):
        snippet = (
            "import sys;sys.path.insert(0,sys.argv[2]);"
            "from core import Store,ControlError;"
            "s=Store(sys.argv[1]);"
            "s.acquire('TeamForge','#456','worker-proc','agent/proc-worker',['server/'])"
        )
        procs = [subprocess.Popen(
            [sys.executable, "-c", snippet, self.path, str(ROOT)],
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True,
        ) for _ in range(4)]
        codes = [p.wait(timeout=12) for p in procs]
        for p in procs:
            p.stderr.close()
        self.assertEqual(codes.count(0), 1)
        self.assertEqual(len(codes), 4)

    def test_bad_project_task_and_ttl_fail(self):
        with self.assertRaises(ControlError):
            self.store.acquire("Unknown", "#1", "robot-1", "agent/valid-branch", ["src/"])
        with self.assertRaises(ControlError):
            self.claim("#0")
        with self.assertRaises(ControlError):
            self.claim(ttl=59)
        with self.assertRaises(ControlError):
            self.claim(ttl=True)

    def test_expired_without_checkpoint_cannot_be_recovered(self):
        self.claim(ttl=60)
        self.time += 61
        with self.assertRaises(ControlError):
            self.store.recover("TeamForge", "#303", "runner-two", 1,
                               HEAD_A, "agent/wp6-components")


class LiveTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.store = Store(str(Path(self.tmp.name, "db", "agent.sqlite")))
        self.issues = [
            {"number": 303, "title": "Component primitive visual", "state": "open",
             "body": '<!-- teamforge-task-v1 {"priority":"p2","readiness":"agent-ready","area":"unity"} -->',
             "labels": [], "html_url": "https://github.com/x/issues/303"},
            {"number": 304, "title": "Needs review", "state": "open", "body": "",
             "labels": [], "html_url": "https://github.com/x/issues/304"},
        ]
        self.pulls = [{"number": 25, "state": "open", "title": "Fixes #304", "body": "",
                       "head": {"ref": "agent/review", "sha": HEAD_A}, "html_url": "https://github.com/x/pull/25"}]
        self.live = LiveGitHub(self.fake_api)

    def fake_api(self, path):
        if path == "repos/Eun-si123/teamforge-unity-collab":
            return {"private": False, "default_branch": "main"}
        if path == "repos/Eun-si123/teamforge-unity-collab/branches/main":
            return {"commit": {"sha": HEAD_A}}
        if path.startswith("repos/Eun-si123/teamforge-unity-collab/issues?"):
            return self.issues
        if path.startswith("repos/Eun-si123/teamforge-unity-collab/pulls?"):
            return self.pulls
        if path == "repos/Eun-si123/teamforge-unity-collab/issues/303":
            return self.issues[0]
        if path == "repos/Eun-si123/teamforge-unity-collab/git/ref/heads/agent/wp6-components":
            return {"object": {"sha": HEAD_A}}
        raise ControlError("Unexpected fake path.")

    def test_private_repository_is_resolved_only_from_owner_private_host_file(self):
        filename = Path(self.tmp.name, "private-repos.json")
        filename.write_text('{"BetterNet":"internal-owner/private-workspace"}')
        filename.chmod(0o600)
        from unittest.mock import patch
        with patch.dict(os.environ, {"AGENT_CONTROL_PRIVATE_CONFIG": str(filename)}):
            self.assertEqual(repository_for("BetterNet"), "internal-owner/private-workspace")
            filename.chmod(0o644)
            with self.assertRaises(ControlError):
                repository_for("BetterNet")
            filename.chmod(0o600)
            filename.write_text('{"BetterNet":"not-a-repo"}')
            with self.assertRaises(ControlError):
                repository_for("BetterNet")

    def test_status_and_candidate_filter(self):
        status = self.live.status("TeamForge")
        self.assertEqual(status["openIssues"], 2)
        self.assertEqual(status["openPRs"], 1)
        self.assertEqual(status["head"], HEAD_A)
        result = self.live.next_tasks("TeamForge", self.store)
        self.assertEqual(result["readyCandidates"], 1)
        self.assertEqual(result["tasks"][0]["number"], 303)
        self.assertEqual(result["tasks"][1]["selection"], "NOT_AUTO_SELECTABLE")
        self.store.acquire("TeamForge", "#303", "runner-one", "agent/wp6-components", ["unity-package/"])
        result = self.live.next_tasks("TeamForge", self.store)
        self.assertEqual(result["readyCandidates"], 0)

    def test_untrusted_body_and_safe_metadata(self):
        context = self.live.task_context("TeamForge", 303)
        self.assertEqual(context["source"], "LIVE_GITHUB")
        self.assertIn("UNTRUSTED", context["untrustedContent"])
        bad = dict(self.issues[0])
        bad["body"] = '<!-- teamforge-task-v1 {"priority":"p0","readiness":"agent-ready","area":"unity"} -->'
        bad["labels"] = [{"name": "priority:p1"}]
        self.assertTrue(self.live.triage(bad)["metadataConflict"])

    def test_mcp_init_list_and_read_only_tools(self):
        init = handle({"jsonrpc": "2.0", "id": 1, "method": "initialize",
                       "params": {"protocolVersion": "2025-06-18"}}, live=self.live, store=self.store)
        self.assertEqual(init["result"]["protocolVersion"], "2025-06-18")
        tools = handle({"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
                       live=self.live, store=self.store)["result"]["tools"]
        self.assertEqual(len(tools), 5)
        self.assertTrue(all(t["annotations"]["readOnlyHint"] for t in tools))
        self.assertFalse(any("acquire" in t["name"] for t in tools))
        result = handle({"jsonrpc": "2.0", "id": 3, "method": "tools/call",
                         "params": {"name": "get_project_status", "arguments": {"project": "TeamForge"}}},
                        live=self.live, store=self.store)
        self.assertEqual(json.loads(result["result"]["content"][0]["text"])["head"], HEAD_A)
        bad = handle({"jsonrpc": "2.0", "id": 4, "method": "tools/call",
                      "params": {"name": "release_task_lease", "arguments": {}}},
                     live=self.live, store=self.store)
        self.assertTrue(bad["result"]["isError"])

    def test_mcp_stdio_handshake_no_extra_debug_stdout(self):
        env = {**os.environ, "AGENT_CONTROL_DB": str(Path(self.tmp.name, "db", "agent.sqlite"))}
        requests = [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize",
             "params": {"protocolVersion": "2025-11-25"}},
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
        ]
        proc = subprocess.run([sys.executable, str(ROOT / "mcp_stdio.py")],
                              input="\n".join(json.dumps(i) for i in requests) + "\n",
                              text=True, capture_output=True, timeout=12, env=env)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        responses = [json.loads(line) for line in proc.stdout.splitlines()]
        self.assertEqual(len(responses), 2)
        self.assertEqual(responses[0]["result"]["protocolVersion"], "2025-11-25")
        self.assertEqual(len(responses[1]["result"]["tools"]), 5)


if __name__ == "__main__":
    unittest.main()

