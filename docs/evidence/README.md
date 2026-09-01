# TeamForge evidence

Evidence records describe **what was actually observed or verified for a specific source revision, artifact, environment, scenario, or audit**. They are not general current-status pages.

Use [../STATUS.md](../STATUS.md) for current capability/readiness claims and [../TEST_LAB.md](../TEST_LAB.md) for named validation-scenario semantics.

## Evidence rules

- A result proves only the scenario and environment that actually ran.
- Source CI, Unity automation, same-machine multi-project testing, physical field testing, static analysis, and exact release validation are different evidence classes.
- A later source commit does not retroactively change an already-published artifact.
- Retry/fallback success does not erase the initial failure that required the retry.
- Historical evidence should remain frozen or receive clearly marked annotations; do not rewrite old observations to match current behavior.

Subdirectories may be added only when real records need them. `verification/` contains focused verification/regression evidence that does not itself own current release status.
