# M5 saved Project preview while hosting

Convergence Agent owns `agent/teamforge/m5-host-checkpoint-preview-20261120`
in a separate worktree based on main `65c3bfe9c94d9c59904543b61dd7a6f4ed116326`.
The hourly development task continues independent work. The Guest comparison
and refresh work is tracked in [#578](https://github.com/Eun-si123/teamforge-unity-collab/pull/578).

Host Ready exposes a saved-file review against the exact signed revision that
the current host serves. A separate, owned worker uses the existing transfer
manifest scanner and reports additions, changes, and deletions. The worker
checks the source descriptor, launch settings, and approved pointer around the
scan. The preview has no authority to publish, write shared artifacts, save
Unity assets, or restart the Coordinator and Seed. Stop remains available
during a scan.

The PR tracks exact Node, Unity, and packaged evidence. An active Session's
signed baseline transition remains tracked in [#560](https://github.com/Eun-si123/teamforge-unity-collab/issues/560).
