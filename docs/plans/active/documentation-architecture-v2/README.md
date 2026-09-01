# Documentation Architecture V2

> **Status:** Active
> **Last reviewed:** 2026-09-01
> **Class:** Active plan
> **Authority:** Planning only — this directory does not override current source, tests, contracts, or canonical documentation.

This directory contains the active migration package for TeamForge Documentation Architecture V2.

## Read in this order

1. [DESIGN_REVIEW.md](DESIGN_REVIEW.md) — preferred V2 direction and resolved design questions.
2. [INVENTORY.md](INVENTORY.md) — file-by-file classification and migration risks.
3. [MIGRATION_PLAN.md](MIGRATION_PLAN.md) — migration sequencing and safety rules.
4. [DESIGN.md](DESIGN.md) — original broader proposal and rationale.

## Intended outcome

Make current truth, decisions, plans, evidence, lessons, and history easy to distinguish for both humans and agents without moving stable current canonical URLs merely for symmetry.

## Current migration state

- canonical current documents remain at their stable paths;
- ambiguous `roadmap.md` / high-risk work-state entry points have started moving toward explicit history/compatibility-pointer handling;
- `docs/history/` is classified as historical by the repository manifest generator;
- the remaining raw `docs/work-state/` material still requires staged audit/migration;
- human/agent routing and readability are being refined before any merge.

## Completion criteria

This plan is ready to leave `active/` only when:

- current canonical routing is clear for humans and agents;
- high-risk historical filenames no longer masquerade as current truth;
- remaining work-state/history migration has an explicit disposition;
- Pages/repository discovery agrees with the final history paths;
- documentation validators cover the intended lifecycle boundaries without rewriting old evidence;
- `npm run validate:docs` and `npm run validate` pass on the final migration branch;
- the resulting diff is reviewed before any merge to `main`.

A completed plan is not itself evidence that these criteria passed; link the actual commits, CI/validator results, and relevant evidence when closing it.
