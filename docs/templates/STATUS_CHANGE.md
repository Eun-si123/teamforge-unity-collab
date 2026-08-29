# Status capability update template

Use this structure when adding or materially changing one capability in `docs/STATUS.md`. Adapt it to the existing table/section style rather than pasting this file verbatim.

## Capability

**Name:** <capability>

**State:** `✅ Exists` / `🟡 Stabilizing` / `⏳ Planned` / `🔬 Research`

### What exists

State only what is actually implemented in current source.

### Evidence

Separate evidence by type when relevant:

- automated/unit/integration evidence;
- Unity/real-server automation;
- local multi-project evidence;
- physical field evidence;
- exact packaged-artifact evidence.

Do not generalize one evidence class into another.

### Remaining boundary

What is still unverified, unsupported or blocking a stronger claim?

### Links

Prefer links to the live GitHub Issue/PR, dated evidence, architecture/reference document or artifact identity instead of copying full timelines into STATUS.

## Wording checks

Before calling something:

- **implemented** — verify the source contains it;
- **tested** — name the evidence class that exercised it;
- **field validated** — require the actual field scenario;
- **supported** — verify the project intentionally makes that support claim;
- **fixed** — distinguish merged implementation from still-pending required validation;
- **released** — identify the exact artifact, not only the source branch.
