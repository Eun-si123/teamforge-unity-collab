# M5 — Unity native asset imports invalidate signed Project review previews

**Development checkpoint · Draft PR · Source only · Not field-validated**

## Problem and observed implementation

TeamForge's existing Host UI already has a read-only saved-source checkpoint comparison against the signed Publisher-approved Baseline. It does **not** activate a new revision or magically synchronize third-party FBX/Prefab/material data as M1–M3 live messages. That is correct: the Node Coordinator requires an authenticated Project checkpoint transition while retained M2/M4 component edits exist. However, the Editor previously kept showing a successful or "no changes" preview after a user imported, removed or moved an Asset or saved a Scene. A comparison from before an import cannot tell the user whether marketplace content is in the currently approved Baseline.

## Narrow implementation

- Native Unity `AssetPostprocessor.OnPostprocessAllAssets` observes imported, deleted, renamed/moved **Assets/** and embedded **Packages/** content using **path-only notifications**. `EditorSceneManager.sceneSaved` handles saved Scene edits. No filesystem polling, network request, import interception, custom asset format, automatic file transfer, or runtime protocol is added. Paths are never logged/copied to public telemetry, and non-project/unsafe paths do not initiate a preview refresh.
- Only an actual Host Ready session with a previously verified pinned M5 checkpoint preview context may mark local source changes. An idle, Guest, stopping or disconnected session is unaffected. A single delayed UI refresh coalesces entire import batches, so Unity importing many model/material/texture files does not trigger repeated work.
- On source change, immediately discard the old `Review` and increment a local generation serial; a preview worker started before the change is no longer allowed to publish its result. When the previous read-only preview is still running, request its cancellation **after** the Asset import callback returns. The old worker's finalizer cannot clear a new session's cancellation token. Neither the import nor cancellation changes the signed Baseline, sends a command to another Editor, or stops the Host.
- The existing Host "Review saved changes" control shows a localized warning: imported Prefab/model/texture/package and Scene edits are **not** yet shared to peers. Unsaved Scene content is also called out. After a fresh successful preview, the hint can clear, but any real changed-file summary remains explicitly labeled **NOT published**.

## Safety boundaries

The existing M5 checkpoint preview remains **read-only** with the same signed `projectUuid`, revision, SHA-256 digest and bounded output/path validation. A local event is never authority to distribute untrusted marketplace content. The UI intentionally does not offer an unaudited "Publish Now" during a live durable Collider Session; the Coordinator currently blocks uncheckpointed baseline swaps. Existing signed Project Peer transfer/review is still required for external assets. This change is visibility and stale-result correctness only, **not external Prefab live sync**.

## Verification scope

Authored Unity EditMode tests in `TeamForgeUxTests`: `UnityNativeAssetNotificationsDetectImportedMovedDeletedProjectFilesOnly` covers relevant import/delete/move and embedded Package paths while excluding Library/Temp, absolute paths and path traversal; `AssetImportInvalidatesOnlyCurrentHostCheckpointReviewWithoutPublishing` exercises a synthetic Ready Host with an old preview, verifies that a local import discards that preview, invalidates a captured generation, preserves the Host state and does not publish. The test restores the static Host state and does not start a Coordinator or write user files.

Local lightweight source/documentation/engineering checks are run separately. **No real Unity Editor test, marketplace package import, publish, two-Windows-PC transfer or signed Guest activation is claimed by this checkpoint**. The release remains `FIELD_BLOCKED`; the later batched field plan should import an Asset Store/FBX Prefab, save the Scene, verify the stale review is removed, verify a fresh signed diff includes `.meta` dependencies, and test the separately approved Project update/Guest activation without overwriting unsent M4 edits.
