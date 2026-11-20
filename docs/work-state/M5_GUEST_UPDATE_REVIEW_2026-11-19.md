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
on both Node 22.23.2 and 24.22.1. The Launcher tests cover the bounded dialog
data, decisions and receive lifecycle. The Linux Windows-target WPF build
passed using .NET 10.0.303. Windows Launcher execution, new packaged artifacts
and physical Host/Guest confirmation are reported separately in the PR.
