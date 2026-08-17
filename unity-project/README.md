# TeamForge 0.5.1 validation project

This minimal project pins Unity `6000.3.21f1` and loads
`unity-package/com.eunsung.teamforge` through the relative `file:` reference
in `Packages/manifest.json`.

Realtime Protocol, Project Transfer Protocol, and Manifest Schema remain 1.
Run the EditMode suite with:

```powershell
& '<candidate>\scripts\teamforge.ps1' unity-test
```

or use **Window > General > Test Runner** and
`EunSung.TeamForge.Editor.Tests`.

This project is a test fixture, not the normal Guest bootstrap destination.
The exact 0.5.1 Unity Compile/EditMode result and the two-PC Windows field result
must be reported separately. Do not infer either from Node/static validation.
