# TeamForge Phase 3 v0.4.1 Closure Known Issues

- Windows/Unity generated PackageCache paths can still exceed environment-specific filesystem/editor limits. TeamForge warns but does not control Windows long-path policy.
- Linux/macOS and Docker deployment matrices were not newly executed in this closure environment.
- Unity 6000.3.21f1 was not launched here; no Unity C# files changed from the user-field-tested Hotfix3 package.
- Phase 5 persistent operation/recovery storage remains intentionally unimplemented.
