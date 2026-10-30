"""Unit tests for best-effort UPM inventory (not Unity Editor resolution)."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SCRIPT = Path(__file__).with_name("unity_dependency_snapshot.py")
SPEC = importlib.util.spec_from_file_location("unity_dependency_snapshot", SCRIPT)
MOD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MOD)


class UnityDependencySnapshotTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.write("unity-project/Packages/manifest.json", {
            "dependencies": {
                "com.eunsung.teamforge": "file:../../unity-package/com.eunsung.teamforge",
                "com.unity.test-framework": "1.6.0",
            }
        })
        self.write("unity-package/com.eunsung.teamforge/package.json", {
            "name": "com.eunsung.teamforge",
            "version": "0.5.1",
        })

    def write(self, name, data):
        p = self.root / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(data), encoding="utf-8")

    def test_manifest_only_is_explicitly_declaration_only(self):
        resolved, evidence = MOD.read_upm(self.root)
        self.assertEqual(evidence["coverage"], "manifest-declarations-only")
        self.assertEqual(evidence["listed_total"], 2)
        self.assertEqual(
            resolved["com.unity.test-framework"]["package_url"],
            "pkg:generic/com.unity.test-framework@1.6.0",
        )
        self.assertEqual(
            resolved["com.unity.test-framework"]["scope"], "development"
        )
        self.assertNotIn("metadata", resolved["com.eunsung.teamforge"])

    def test_lock_adds_exact_transitive_edges(self):
        self.write("unity-project/Packages/packages-lock.json", {
            "dependencies": {
                "com.eunsung.teamforge": {
                    "version": "file:../../unity-package/com.eunsung.teamforge",
                    "source": "embedded",
                    "dependencies": {},
                },
                "com.unity.test-framework": {
                    "version": "1.6.1", "source": "registry",
                    "dependencies": {"com.unity.ext.nunit": "1.0.6"},
                },
                "com.unity.ext.nunit": {
                    "version": "1.0.6", "source": "registry", "dependencies": {},
                },
            }
        })
        resolved, evidence = MOD.read_upm(self.root)
        self.assertEqual(evidence["coverage"], "unity-lock-resolved")
        self.assertEqual(evidence["listed_total"], 3)
        self.assertEqual(resolved["com.unity.test-framework"]["package_url"],
                         "pkg:generic/com.unity.test-framework@1.6.1")
        self.assertEqual(resolved["com.unity.test-framework"]["dependencies"],
                         ["pkg:generic/com.unity.ext.nunit@1.0.6"])
        self.assertEqual(resolved["com.unity.ext.nunit"]["relationship"], "indirect")

    def test_existing_empty_lock_object_fails_closed(self):
        # An existing malformed lock must not silently downgrade inventory
        # evidence to "manifest-declarations-only".
        self.write("unity-project/Packages/packages-lock.json", {})
        with self.assertRaisesRegex(ValueError, "packages-lock.dependencies"):
            MOD.read_upm(self.root)

    def test_missing_lock_parent_fails_closed(self):
        self.write("unity-project/Packages/packages-lock.json", {
            "dependencies": {"com.unity.test-framework": {"version": "1.6.0"}}
        })
        with self.assertRaisesRegex(ValueError, "missing direct"):
            MOD.read_upm(self.root)

    def test_malformed_local_path_cannot_escape_checkout(self):
        self.write("unity-project/Packages/manifest.json", {
            "dependencies": {"com.bad": "file:../../../../outside"},
        })
        with self.assertRaisesRegex(ValueError, "escapes repository"):
            MOD.read_upm(self.root)

    def test_unversioned_external_source_rejected(self):
        self.write("unity-project/Packages/manifest.json", {
            "dependencies": {"com.bad": "https://unknown.example/repo.git"}
        })
        with self.assertRaisesRegex(ValueError, "unhandled UPM version source"):
            MOD.read_upm(self.root)

    def test_snapshot_trusted_main_only(self):
        with self.assertRaisesRegex(ValueError, "trusted main"):
            MOD.make_snapshot(
                self.root, "Eun-si123/teamforge-unity-collab", "a" * 40,
                "refs/pull/123/merge", "1234"
            )

    def test_snapshot_manifest_does_not_replace_npm(self):
        snap, evidence = MOD.make_snapshot(
            self.root, "Eun-si123/teamforge-unity-collab", "a" * 40,
            "refs/heads/main", "1234"
        )
        self.assertEqual(list(snap["manifests"]), [
            "unity-project/Packages/manifest.json"
        ])
        self.assertEqual(snap["job"]["correlator"], "unity-upm-declarations")
        self.assertEqual(evidence["listed_total"], 2)
        entry = snap["manifests"]["unity-project/Packages/manifest.json"]
        self.assertNotIn("metadata", entry["file"])
        for dep in entry["resolved"].values():
            self.assertNotIn("metadata", dep)


if __name__ == "__main__":
    unittest.main()
