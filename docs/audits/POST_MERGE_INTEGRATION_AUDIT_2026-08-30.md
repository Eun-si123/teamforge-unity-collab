# Post-merge integration audit — 2026-08-30

This audit checks whether the documentation/engineering/operability work merged through PR #103 was integrated across the rest of the repository rather than merely added as isolated files.

This is a **dated audit record**, not a current status source. Current capability/readiness belongs to `docs/STATUS.md`.

## Scope

Reviewed integration among:

- README / Korean README / docs map;
- HOW_IT_WORKS, architecture, SOURCE and CODEMAP responsibility layers;
- Engineering Guide, Documentation Guide, AGENTS and contribution paths;
- Test Lab, test strategy, package scripts and validation routes;
- Launcher support-bundle behavior, support/reporting surfaces and artifact identity;
- `llms.txt`, Pages mirrors, `project.json`, HTML rendering, semantic/XML sitemaps and site verification;
- changelog and development-history recording;
- source-versus-published-candidate claims.

## Findings corrected

### 1. Discovery surfaces still described the old documentation architecture

`llms.txt`, Pages generation and HTML/search tooling had not been fully updated for HOW_IT_WORKS, Test Lab, Engineering Guide and Documentation Guide. SOURCE was still described in places as the LLM/code-reading guide even though CODEMAP now owns question-to-code navigation.

Corrective action:

- route current canonical documents through `llms.txt`;
- add clean Pages mirrors and `project.json` routes;
- render the appropriate documents as ordinary HTML;
- add sitemap and live-smoke coverage;
- remove the obsolete SOURCE role label;
- strengthen generated-site verification.

### 2. Korean README lagged the English documentation entry path

The English README exposed HOW_IT_WORKS and Test Lab while the Korean README did not.

Corrective action:

- add the Korean HOW_IT_WORKS route to navigation and the post-demo reading path;
- add Test Lab validation guidance;
- align the repository-guide table with the current documentation layers.

### 3. Test strategy still described Test Lab as future work

`docs/testing-strategy.md` said a future unified Test Lab might orchestrate scenarios even though Test Lab had already been implemented.

Corrective action:

- describe the existing Test Lab as a thin orchestration layer;
- preserve owning tests as the source of assertions;
- retain PASS/FAIL/INCOMPLETE and no-hidden-retry boundaries.

### 4. New diagnostics behavior was missing from source/navigation/reporting routes

The Launcher support bundle existed, but SOURCE/CODEMAP and issue-reporting surfaces were not fully aligned with it.

Corrective action:

- add diagnostics contract checks to SOURCE;
- route `DiagnosticSupportBundle`, diagnostics UI and tests through CODEMAP;
- explain the support bundle in HOW_IT_WORKS as observational rather than authority/recovery bypass;
- update bug/testing issue forms while warning that arbitrary Test Lab/process logs do not inherit the support bundle redaction contract.

### 5. Current source and r4 package were described too similarly

The initial post-r4 documentation cleanup said later `main` changes were repository/documentation-only. PR #103 also added real Launcher support-bundle behavior, so current `main` is behaviorally newer than the immutable r4 ZIP.

Corrective action:

- update STATUS and build classification to preserve r4 as the exact existing field-blocker candidate while explicitly stating that r4 is not byte/behavior equivalent to current `main`;
- record the support-bundle source change in the changelog;
- require a new immutable candidate if current `main` is packaged for new field/release claims;
- do not silently rebuild or extend r4 evidence to later source.

### 6. Documentation governance did not enforce propagation

The repository had canonical ownership rules but no explicit rule saying a new/renamed/reclassified canonical document must be reviewed across navigation/discovery surfaces.

Corrective action:

- add canonical-document propagation classes and review surfaces to `DOCUMENTATION_GUIDE.md`;
- update AGENTS instructions;
- make `validate-documentation.mjs` check paired README routes, `llms.txt`, Pages mirrors/project metadata, SOURCE/CODEMAP role separation, current Test Lab wording, new diagnostics routing, and current source/package divergence.

## Evidence boundary

This audit is repository integration work. It does not close the existing physical two-PC WP5.1 field gates and does not publish or replace a packaged candidate.

The audit branch must pass its own CI/Pages/Unity/quality checks before its corrections are considered ready to merge.
