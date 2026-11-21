# M4 recovery of changes to an object's parent

Convergence Agent owns `agent/teamforge/m4-reparent-recovery-20261120` in a
separate worktree based on [#580](https://github.com/Eun-si123/teamforge-unity-collab/pull/580)
at `16dc974e06be95f0dd5e68f8a856352a773c46da`. The hourly task continues independent
Windows field tooling under its existing schedule.

Session Recovery preserves a pending native reparent of an existing shared
GameObject in the same saved non-Prefab Scene. The archive holds the target and
parent identity generations, sibling position and local Transform on both
sides of the move. The Editor compares the saved and confirmed placement and
submits only after explicit review. The Coordinator checks the opted-in wire,
authority epoch, the child's current lease and all three reviewed revisions.
Existing same-Scene parent and cycle checks guard the destination.

Node 22.23.2 and 24.22.1 each passed 444 server cases. Actual WebSocket tests
cover confirmation, stale revisions or authority, parent and child conflicts,
legacy negotiation, replay and restart. The Unity fixture requires save/reopen,
Coordinator restart, no automatic replay and application of a reviewed parent,
sibling index and local Transform verified by a separately connected Node peer.
The PR records the exact Editor result. Physical multi-Editor Windows and a new
installation package have not been tested for this slice.
