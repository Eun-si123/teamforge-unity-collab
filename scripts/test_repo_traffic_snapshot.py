#!/usr/bin/env python3
"""No-network regression tests for the repository traffic observation collector."""

import importlib.util
import tempfile
import unittest
from datetime import date
from pathlib import Path


PATH = Path(__file__).with_name("repo_traffic_snapshot.py")
SPEC = importlib.util.spec_from_file_location("repo_traffic_snapshot_tests", PATH)
assert SPEC and SPEC.loader
collector = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(collector)


class CollectorTests(unittest.TestCase):
    def setUp(self):
        self.calls = []

    def request(self, path, token):
        self.calls.append((path, token))
        if "/actions/runs?" in path:
            return {"total_count": 10}
        if "/traffic/clones" in path:
            return {"count": 51, "uniques": 7, "clones": [
                {"timestamp": "2026-10-11T00:00:00Z", "count": 19, "uniques": 5},
                {"timestamp": "2026-10-12T00:00:00Z", "count": 32, "uniques": 6},
            ]}
        if "/traffic/views" in path:
            return {"count": 17, "uniques": 11, "views": [
                {"timestamp": "2026-10-12T00:00:00Z", "count": 17, "uniques": 11},
            ]}
        if "/popular/paths" in path:
            return [{"path": "/test", "count": 9, "uniques": 5}]
        if "/popular/referrers" in path:
            return [{"referrer": "github.com", "count": 9, "uniques": 5}]
        raise AssertionError(path)

    def build(self, traffic_token=""):
        return collector.build_snapshot(
            "Eun-si123/teamforge-unity-collab",
            date(2026, 10, 12),
            self.request,
            actions_token="actions-only",
            traffic_token=traffic_token,
        )

    def test_missing_token_never_calls_private_traffic(self):
        data = self.build()
        self.assertEqual(data["trafficStatus"], "not_configured")
        self.assertIsNone(data["traffic"])
        self.assertEqual(data["actionsRunTotal"], 140)
        self.assertEqual(len(self.calls), 14)
        self.assertTrue(all(token == "actions-only" for _, token in self.calls))
        rows = collector.csv_rows(data)
        self.assertEqual(len(rows), 14)
        self.assertEqual(rows[-1]["clones"], "")  # unknown, not zero
        self.assertIn("not configured", collector.render_report(data))

    def test_traffic_uses_distinct_admin_read_token(self):
        data = self.build("traffic-admin-read")
        self.assertEqual(len(self.calls), 18)
        self.assertEqual(sum(1 for _, token in self.calls
                             if token == "traffic-admin-read"), 4)
        self.assertEqual(data["traffic"]["clones"]["unique14d"], 7)
        # Daily unique cloners 5+6=11; these must NOT be used as 14d total.
        self.assertNotEqual(5 + 6, data["traffic"]["clones"]["unique14d"])
        rows = collector.csv_rows(data)
        self.assertEqual(rows[-2]["clones"], 19)
        self.assertEqual(rows[-1]["clones"], 32)
        self.assertEqual(rows[-1]["views"], 17)
        self.assertEqual(rows[0]["clones"], 19)
        self.assertEqual(rows[0]["views"], "")  # missing day != zero
        self.assertIn("not a verified human", collector.render_report(data))

    def test_traffic_older_window_is_not_shifted_to_today(self):
        # Real Traffic API data can end on the previous UTC day.
        def stale_api(path, token):
            if "/traffic/clones" in path:
                return {"count": 43, "uniques": 7, "clones": [
                    {"timestamp": "2026-09-28T00:00:00Z", "count": 11, "uniques": 3},
                    {"timestamp": "2026-10-11T00:00:00Z", "count": 32, "uniques": 6},
                ]}
            if "/traffic/views" in path:
                return {"count": 5, "uniques": 3, "views": [
                    {"timestamp": "2026-10-11T00:00:00Z", "count": 5, "uniques": 3},
                ]}
            return self.request(path, token)
        data = collector.build_snapshot(
            "owner/repo", date(2026, 10, 12), stale_api,
            actions_token="actions", traffic_token="traffic")
        self.assertEqual(data["datesUtc"], ["2026-09-28", "2026-10-11"])
        self.assertEqual(set(data["actionsRuns"]), {"2026-09-28", "2026-10-11"})
        self.assertEqual(data["actionsRunTotal"], 20)
        self.assertEqual(collector.csv_rows(data)[0]["views"], "")
        self.assertEqual(collector.csv_rows(data)[0]["clones"], 11)
        self.assertNotIn("2026-10-12 |", collector.render_report(data))
        # 09-28 is just outside the naive 14-day Actions query and was fetched.
        self.assertTrue(any("created=2026-09-28" in path for path, _ in self.calls))

    def test_snapshot_outputs_are_machine_readable(self):
        data = self.build("traffic-admin-read")
        with tempfile.TemporaryDirectory() as td:
            target = Path(td) / "reports"
            collector.write_files(data, target)
            self.assertEqual(sorted(p.name for p in target.iterdir()),
                             ["daily.csv", "report.md", "snapshot.json"])
            self.assertEqual((target / "daily.csv").read_text().count("\n"), 3)
            self.assertIn("51", (target / "report.md").read_text())

    def test_api_bad_counts_fail_closed(self):
        def malformed(path, _token):
            return {"total_count": "unknown"}
        with self.assertRaisesRegex(ValueError, "invalid Actions run count"):
            collector.build_snapshot("owner/repo", date(2026, 10, 12),
                                     malformed, actions_token="actions")

    def test_traffic_bad_schema_fails_closed(self):
        def broken(path, token):
            if "/traffic/clones" in path:
                return {"count": 2, "uniques": 1, "clones": "oops"}
            return self.request(path, token)
        with self.assertRaisesRegex(ValueError, "daily array"):
            collector.build_snapshot("owner/repo", date(2026, 10, 12),
                                     broken, actions_token="actions",
                                     traffic_token="traffic")

    def test_utc_window_is_14_days(self):
        window = collector.recent_days(date(2026, 10, 12))
        self.assertEqual((len(window), window[0], window[-1]),
                         (14, "2026-09-29", "2026-10-12"))


if __name__ == "__main__":
    unittest.main()
