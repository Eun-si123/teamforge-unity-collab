# WP6 direct local Project Peer source verification — 2026-11-10

## Why

WP6 #525 added a real read-only Project Peer CLI to verify
the activated signed Scene and metadata bytes against an
approved stored Manifest. #526 added a real Unity Editor
comparison to the current loaded Collider values and
Server Project/Session registry metadata. The only way
to join them required manually pasting a JSON report,
which can be accidentally changed or forged. This
branch adds a direct local execution path but does not
mistake a same-user subprocess for cryptographic
Server↔Editor remote provenance.

## Implementation

- The existing WP6 Test Lab adds an explicit
  Run installed Project Peer locally and compare button.
  It checks the connected Project registry and exact
  clean saved active Scene/Collider witness first.
- TeamForgeRuntimeDiscovery.Resolve uses an already
  pinned package runtime or explicit developer fallback
  workspace, never a user-entered Node executable path.
  Require the fixed CLI below its workspace, with the
  current Project UUID, saved Scene path/GUID and
  default project-local TeamForgeProjects managed root.
- Reject wrong GUID/UUID/path, quotes, controls, missing
  CLI, redirected files. Launch with UseShellExecute=false
  and no shell. Strip authentication token, Owner
  signing key and Node options/path variables.
- Run asynchronously, 15-second timeout, bounded
  streaming stdout/stderr without exposing paths
  from failed CLI stderr. Closing/replacing the Editor
  window ignores late results. No report saved.
- Pass the ephemeral CLI result straight to #526
  saved Unity Scene/Collider and registered Project
  metadata cross-check, then revalidate Scene and
  Project before displaying local match. A direct
  run clears any previous pasted report.
- This is only local runtime source consistency. There
  is no Server-issued nonce, independent Publisher
  attestation of the live Editor, Server-side verification
  of file inclusion, authoritative Component transaction
  or remote apply ACK. A same-user local process is not
  an independently trusted principal. No network
  Component write or Unity mutation is enabled.

## Checks

Two new Unity NUnit tests cover normal fixed-path
invocation, unsafe path/GUID/UUID and quote/control
injection, missing CLI, absent invocation, small
and oversized child output. C# syntax validation,
repository docs/source/engineering/workflow checks,
and exact-head GitHub Unity EditMode CI are separate.
Physical two-Editor Windows Host/Guest and remote apply
remain FIELD_BLOCKED and not claimed here.

Rollback one new stacked Draft commit. No database,
migration, deployed Server, additional service or
release changes.
