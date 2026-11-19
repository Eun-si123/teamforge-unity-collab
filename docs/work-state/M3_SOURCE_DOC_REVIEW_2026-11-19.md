# M3 source documentation and locale evidence — 2026-11-19

Scope: TeamForge main-source M3 merged via PR #569 at
3fa4232e445d65f449b686687f74307225059d70.
Separately PR #570 improves Launcher SHA-256 Runtime hashing by streaming.
Neither change is included in the immutable published r10 Windows ZIP.
Product version and FIELD_BLOCKED state do not change.

The current canonical English/Korean README, STATUS, ROADMAP and root/Unity
CHANGELOG describe built-in Cube/Sphere creation/deletion as explicit opt-in,
not arbitrary Component/Prefab/Asset replication. The M3 PR exact-source CI
passed 40 checks, including a real Unity Editor plus Node peer in three Unity
versions. Actual physical simultaneous two-Editor Windows LAN, 8-Editor soak
and a new exact candidate/package remain NOT RUN.

Fourteen additional preview STATUS translations had their M3 merge and
CI/field limits summarized in the existing evidence paragraph, and the
fifteen long-form status/ reviewed-source pins were advanced to the new
canonical English STATUS blob. Twenty homepage locale manifests were
reviewed against the changed STATUS source hash; their existing Cube
demonstration is an earlier *Transform* demo, not a claim that the M3
Create Shared Cube feature has shipped. The translated homepage copy
was not changed, only its reviewed STATUS source hash. These preview
translations were machine-assisted and are not certified native translations.

Pages Build/Verify, Docs, Engineering and workflow CI must run against the
exact submitted doc branch commit before main merge. Subsequent main changes
or review-pinned source changes require a fresh review.
