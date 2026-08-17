# TeamForge Phase 3 v0.4.1 Closure — Targeted Manual Retest

Broad Phase 0-3 field validation does not need to be repeated solely for these CLI-only Stage A changes. Target only changed boundaries:

1. On Windows, run `sync` once with an intentionally long receiver root and confirm a `windows_unity_path_risk` preflight warning appears before transfer; do not open that Active in Unity for this test.
2. Run interrupted Sync and resume the same root; final JSON must show `resumedChunks > 0` and `resumedBytes > 0`.
3. With an already published unchanged source, rerun `publish`; it must stop with `no_content_changes` and recommend `seed`.
4. Start `seed`; Baseline revision/hash must not change.
5. Verify `sync --partial-seed-max-bytes-per-second 65536` is accepted; the old `--max-bytes-per-second 65536` remains accepted as an alias.
