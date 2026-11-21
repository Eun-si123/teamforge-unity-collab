# M5 Guest Project update review

Convergence Agent owns `agent/teamforge/m5-guest-update-review-20261119` from
`main@5af64ac9de10bb75b04b690ded6f043e02f879b2`. The hourly development agent's
reservation covers this review path, including the signed comparison, Guest
orchestrator and Launcher dialog. M4 Session recovery has separate worktrees.

The Guest compares the verified current manifest against the exact signed
revision advertised by the Coordinator. Review comes before chunk requests
and publication metadata writes. Approval authorizes one receive attempt and
the previously reviewed Active pointer is checked again under the activation
lock. Declining, cancelling or receiving a superseded target preserves the
current Active. An approved transfer reuses verified chunks and activates a
separate directory, preserving edits in the previous Project folder.

The transfer tests use actual signed revisions, Coordinator and Direct Seed
traffic. The full Project Peer suite passed 592 tests with 6 platform skips
on both Node 22.23.2 and 24.22.1 at `0b30b85`. A follow-up regression publishes
another revision during the final Publisher trust await. Activation verifies
the latest received Coordinator publication under the local lock before
moving the staged directory. The 26 focused tests passed on both Node lines.
The Launcher tests cover the bounded dialog
data, decisions and receive lifecycle. The Linux Windows-target WPF build
passed using .NET 10.0.303. Windows Launcher execution, new packaged artifacts
and physical Host/Guest confirmation are reported separately in the PR.

## 2026-11-21 consistency limit (not a global Coordinator linearizability claim)

Approval is pinned to the **signed, exact revision the Guest last received from the Coordinator** and retains the previously verified Active if a *received* later publication invalidates it. The existing `CoordinatorClient.connect()` returns its cached `snapshot` while a WebSocket remains open. A later Host revision may already have been committed by the Coordinator but its broadcast may not have reached this Guest before final local activation. In that case the Guest can legitimately activate its explicitly reviewed older revision, then review a newer revision when it becomes visible. Neither the UI nor the PR may promise a guarantee of the globally latest *issued* Coordinator publication or an atomic distributed commit. A stronger guarantee would require a separate Coordinator-side version/lease/CAS handshake or durable publication epoch before local commit.

The Guest review dialog names this last-observed limitation, keeps the exact revision number visible, and no longer claims the most recent Host-issued revision. The independent review still blocks merge on replacement Publisher trust-pin atomicity. The post-commit cancellation/handoff boundary is handled separately by `9c2f1e5`.
