# Aktueller TeamForge-Status

[English](STATUS.md) · [Funktionsweise](HOW_IT_WORKS.de.md)

_Diese Vorschauübersetzung wurde mit dem englischen kanonischen `STATUS.md` vom 2026-10-10 abgeglichen. Für detaillierte Evidenz, Issues und aktuelle Entscheidungen ist die englische Fassung maßgeblich._

> **Frühe öffentliche Vorschau: TeamForge darf nicht die einzige Kopie oder der einzige Wiederherstellungsweg für ein wichtiges Unity Project sein.** Backups beibehalten und möglichst mit entbehrlichen Test-Projects arbeiten.

## Aktueller Überblick

- Produktlinie: `0.5.1`
- Source lineage: `0.5.1-wp5.1-path-resilience`
- Neuester veröffentlichter Kandidat: `v0.5.1-prealpha-wp5.1-r8`
- r8 Source commit: `4aff5756329c2fe013d78344859e0760c6a382ef`
- Windows-ZIP: `Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r8-win-x64.zip`
- SHA-256: `3a003791043c067009250bf59da4d916e75eb6dc1b1ed0e93d54984a2d23eb21`
- Ziel: Windows x64
- Release-Bereitschaft: **FIELD BLOCKED**
- Unity-Linie: `6000.3` (aufgezeichneter Test-Editor: `6000.3.21f1`)
- Realtime / Project Transfer / Project Manifest: **v1**

## r8-Veröffentlichung und Evidenzgrenze

r8 wurde am 2026-10-10 veröffentlicht und enthält die Korrekturen aus PR #209 für Direct-Seed-Gesundheit, verifiziertes Existing-Active-Öffnen und die Ablehnung verschachtelter Project-Roots. Die veröffentlichte ZIP hat die Windows Exact Release Validation (Lauf 38019297086) bestanden; **ein Test mit r8 auf zwei physischen Windows-PCs steht noch aus**. Die Freigabe bleibt **FIELD BLOCKED**. Die nachfolgenden r7-Ergebnisse sind historische Nachweise und keine r8-Feldtests. Die später integrierten PRs #217 und #219 sind nicht Teil der r8-ZIP.

## Evidenzgrenze von r7

r7 wurde am 2026-10-03 aus Commit d88ca4c41ecf1f9cc7aa5d349960f407f158ce9a veröffentlicht und bestand danach die Windows **Exact Release Validation**. Dabei wurde das Release-ZIP erneut heruntergeladen, SHA-256 und jeder Hash im release manifest geprüft, aus einem fremden Arbeitsverzeichnis in einen neuen Pfad mit koreanischen Zeichen und Leerzeichen entpackt sowie das gebündelte Runtime/Node, fail-closed Launcher-Verhalten, Windows path resilience und reale Junction-Prüfungen validiert.

Das ist **automatisierte Evidenz für genau dieses Paket**. In einem späteren physischen Test mit r6-Host und exaktem r7-Guest verwendete der Guest den vorhandenen managed root ohne `destination_contains_unmanaged_content`; nachdem das vertrauenswürdige Host-LAN-Profil von Public auf Private geändert wurde, lief der Ablauf über Publisher trust, Project receive und Unity-Start bis zu einer gemeldeten TeamForge-Verbindung weiter. Noch nicht bewiesen sind exact r7 auf beiden PCs, frisches nicht erhöhtes UAC-Onboarding, Seed-Port-Fallback oder physisches Project-identity-Recovery nach abnormalem Prozessverlust. Deshalb bleibt der Status FIELD BLOCKED.

Die physische r5-Evidenz vom 2026-08-31 bleibt für die damals tatsächlich ausgeführten reconnect-, late-join-, receive/resume-, long-path-, lock-contention- und Seed-`5091`/Transfer-Szenarien gültig. r7 ändert weder die r5-Bytes noch deren historische Ergebnisse.

## Spätere r7-on-Host-Blocker und erneute Prüfung mit r8

Spätere physische Tests zeigten `baseline_unavailable`, obwohl der Host ohne auffindbaren Direct Project Peer weiterhin Ready meldete, eine Long-Path-`DirectoryNotFoundException` beim Öffnen eines bestehenden verifizierten Projects. Die Source-Prüfung zeigte außerdem das Risiko verschachtelter UUIDs bei Auswahl eines einzelnen Project-Verzeichnisses als Projects root.

PR #209 wurde am 2026-10-08 in `main` integriert; die Korrekturen sind im veröffentlichten **r8-ZIP enthalten**. Die Windows Exact Release Validation von r8 (Lauf 38019297086) bestand, aber der erneute Test auf zwei physischen Windows-PCs steht aus. Zu prüfen sind das Zurücknehmen von Ready bei fehlendem Direct Seed, Existing-Active über den kurzen Pfad und die Ablehnung eines Project-UUID-Verzeichnisses als Projects root. Die ursprüngliche Ursache des Seed-Verlusts ist ungeklärt. Der frühere gemischte r6/r7-PASS gilt nur für seinen damaligen Umfang; der Status bleibt **FIELD BLOCKED**.

[PR #209](https://github.com/Eun-si123/teamforge-unity-collab/pull/209) · [English evidence/status](https://eun-si123.github.io/teamforge-unity-collab/status/#later-r7-on-host-blockers-now-packaged-for-r8-retest)

## Aktueller Funktionsumfang

Presence, Selection, Transform-Synchronisierung, grundlegendes lock/ownership, unterstützte Same-Scene-Hierarchy-Operationen, direkter P2P Project transfer, Diagnose/Recovery-UX und Windows path resilience sind implementiert oder in Stabilisierung. r7 enthält außerdem Windows firewall onboarding nach r5, Fallback bei belegtem/nicht verfügbarem Seed port, Windows Project identity crash recovery, zusätzliche Diagnostics und `TeamForge · Locked by <owner>`-Feedback in SceneView.

Allgemeine Component/Inspector-Synchronisierung, Prefab/allgemeine Asset collaboration, persistente server/session restart recovery und automatisches Internet NAT traversal/relay werden derzeit nicht unterstützt.

## Noch ausstehende Feldprüfung

1. **Exaktes r8** frisch auf zwei Windows-PCs entpacken und Firewall onboarding/UAC, enge Regeln für Private + `LocalSubnet` sowie deren lifecycle prüfen.
2. Belegung/Nichtverfügbarkeit des bevorzugten Seed ports erzwingen; tatsächliche Erreichbarkeit des nach Fallback angekündigten Endpoints sowie Host Stop/Start und Fresh Guest transfer prüfen.
3. Abnormalen Prozessverlust während Project identity simulieren und sichere Recovery sowie weiterhin fail-closed Verhalten bei mehrdeutigen/konfligierenden Identitäten bestätigen.
4. Fresh Host → Fresh Guest → Unity realtime smoke durchführen; foreign-lock Feedback muss verständlich sein und nach release/takeover verschwinden.
5. #182 als intermittierende CI-Beobachtung behalten und nicht durch retry/skip verdecken; #79 bleibt UX-Follow-up für transienten SceneView-Edit.

## Maßgebliche Quellen

Details zu Fähigkeiten, Blockern und Evidenz: [English STATUS](STATUS.md); exakte Auswahlen: [`release-contract.json`](../release-contract.json); veröffentlichte Byte-Identität: [`builds/README.md`](../builds/README.md) plus GitHub-Release-SHA-256.
