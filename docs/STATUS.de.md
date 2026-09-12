# Aktueller Stand von TeamForge

[English](STATUS.md) · [Funktionsweise](HOW_IT_WORKS.de.md)

_Dokumentprüfung des Originals: 2026-09-10 UTC. Abgleich des neueren main-Codes einschließlich Windows-Netzwerk, Diagnose und Projektidentität nach r5 mit dem veröffentlichten r5-Artefakt und dessen exakten physischen Ergebnissen vom 2026-08-31. Paketnachweise und Nachweise für neueren Quellcode bleiben getrennt._

> **Frühe öffentliche Vorschau: TeamForge darf nicht die einzige Kopie oder Wiederherstellungsmöglichkeit eines wichtigen Unity-Projekts sein.** Die ursprünglichen WP5.1-Windows-Blocker wurden umfangreich am exakten r5 auf realen PCs geprüft. main ist neuer und enthält zusätzliches Netzwerk-/Identitätsverhalten, das noch nicht gemeinsam als exaktes Ersatzpaket auf physischen PCs validiert wurde. Sicherungen behalten und entbehrliche Testprojekte bevorzugen.

[STATUS auf Englisch](STATUS.md) ist die maßgebliche menschenlesbare Quelle für Fähigkeiten und Veröffentlichungsreife. Andere Dokumente verlinken dorthin statt konkurrierende Blockerlisten zu pflegen. Exakte Auswahlen: [release-contract.json](../release-contract.json); Byteidentität und abgelöste Builds: [builds/README.md](../builds/README.md); Fehlerdetails und historische Reproduktion: GitHub Issues.

## Überblick

- Produktlinie: `0.5.1`; Quellcodelinie: `0.5.1-wp5.1-path-resilience`.
- Neuester veröffentlichter Paketkandidat: `v0.5.1-prealpha-wp5.1-r5`.
- r5-Quell-/Tag-Commit: `a97b6ba5649e2888b909bf3c99c64acfd7042ba6`.
- ZIP: `Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r5-win-x64.zip`.
- SHA-256: `5944abf2263502ee40f49d0ac2c8a9826a809dc4cd1b20c9edf82f94ba35f8cc`.
- Paketziel: Windows x64; Freigabestatus: **FIELD BLOCKED** — Feldbedingungen noch nicht erfüllt.
- Unity-Linie: `6000.3`; dokumentierter Test-Editor des Kandidaten: `6000.3.21f1`.
- Realtime Protocol, Project Transfer Protocol und Project Manifest Schema: jeweils **v1**.

## Quellcode gegenüber Paket

Die ursprünglichen WP5.1-Korrekturen für #67, #68/#74, #69, #70 und #71 wurden bis PR #81 integriert. r5 stammt vom obigen Commit und enthält diese sowie die nach r4 ergänzte Launcher-Integration **Save support bundle**.

Am 2026-08-31 wurde exakt r5 auf zwei physischen Windows-PCs geprüft: Wiederverbindung eines gespeicherten Guest, frischer später Beitritt mit Transform-Snapshot, wiederholter Empfangsabbruch/Wiederaufnahme, Übergabe langer/tiefer Pfade über execution alias und Wiederherstellung nach veraltetem geschütztem Sperrkonflikt. Nach notwendiger Firewallfreigabe wurden auch Host Stop/Start mit erneuter Bindung an Seed TCP `5091` und echter Guest-Transfer bestätigt.

Diese Szenarien warten nicht mehr auf ihren ersten physischen r5-Nachtest. Die Ergebnisse machen spätere Änderungen weder zu r5-Verhalten noch das Produkt zu einer allgemein installierbaren Alpha. Aussagen zum Paket gelten für r5 und seine Belege vom 2026-08-31; r5 ist nicht byte- oder verhaltensgleich mit main. Alte Listen dürfen abgeschlossene r5-Szenarien nicht wieder als offen führen. Für main als Ersatzkandidat braucht es ein neues unveränderliches Artefakt mit Prüfung der tatsächlich nach r5 ergänzten Funktionen.

## Neuere Absicherung, nicht in r5

- Windows-LAN-Firewalleinrichtung kann nach ausdrücklicher Nutzer- und UAC-Zustimmung eng begrenzte Coordinator-/Seed-Eingangsregeln für Private und LocalSubnet anlegen; eigene TeamForge-Regeln werden abgeglichen/bereinigt. Der r5-Feldtest brauchte manuelle Freigaben; der neue Ablauf benötigt exakte Paket-Feldnachweise.
- Bei belegtem/nicht verfügbarem bevorzugtem oder Standard-Seed-Port, einschließlich Windows-Bindekontext `EACCES`, versucht Host einmal einen vom Betriebssystem zugewiesenen Port und veröffentlicht den gewählten Endpunkt. Automatisierte Windows-Project-Peer-Tests existieren; das Verhalten ist neuer als r5.
- Serialisierte Projektidentitätserstellung und Windows-Absturzwiederherstellung mit OS-eigener named-pipe-Livesperre und dauerhaftem Kompatibilitätszaun für alte Schreiber. Windows-Absturz-/Parallelitätssuiten unter Node 22/24 bestanden; kein veröffentlichtes Paket mit dieser Änderung hat exakte physische Nachweise.
- Aufräumen bei Coordinator-Ablehnung, HTTP-Abbruch/Fristen, besserer Host-Diagnosekontext, WebSocket-Clientrollenlogs sowie klare Unterscheidung Launcher-Einladung/`TF1`-Verbindungscode.

Das sind Quellcode-/Automatisierungsbelege, keine r5-Paketfunktionen. Linux/macOS-Wiederherstellung veralteter Identitätssperren liegt außerhalb dieser Windows-Änderung.

## Fähigkeiten

| Bereich | Quellcodestand | Nachweisgrenze |
| --- | --- | --- |
| Anwesenheit verbundener Nutzer | Implementiert/ausgeführt | Zwei-PC-Basis funktionierte; breitere externe Tests sinnvoll |
| Auswahl/Editor-Kontext | Implementiert/ausgeführt | Breitere externe Tests sinnvoll |
| Transform-Synchronisierung | Implementiert/in Stabilisierung | r5 später Beitritt und Konflikterholung PASS; Feldabdeckung und UX offen |
| Grundlegende Sperren/Eigentum | Implementiert/in Stabilisierung | r5 Konflikt/Erholung PASS; Bearbeitungs-UX bei fremder Sperre: #79 |
| Gleiche Scene: Hierarchy erstellen/löschen/umbenennen/umhängen/ordnen | Implementiert/in Stabilisierung | Teilmenge physisch erprobt; breitere Abdeckung sinnvoll |
| Projektstart/Collaboration Invite | Implementiert/in Stabilisierung | Gespeicherter Guest r5 PASS; neuere Identitätsrettung ohne Paket/Feldbeleg |
| Direkter P2P-Transfer | Implementiert/in Stabilisierung | r5 `5091` Stop/Start und Transfer PASS; neue Firewall-/Portpfade ohne Ersatzpaket-Feldbeleg |
| Diagnose/Wiederherstellungs-UX | Implementiert/in Stabilisierung | r5 enthält datenschutzbewusstes Supportpaket; spätere Verbesserungen nur Quellcode |
| Windows-Pfadrobustheit/execution alias | Implementiert/in Stabilisierung | r5 lange/tiefe Übergabe PASS; schädliche/fremde Alias-Ablehnung automatisiert fail-closed |
| Component/Inspector | Geplant | Allgemeines Hinzufügen/Entfernen von Component und SerializedProperty-Sync nicht unterstützt |
| Prefab/allgemeine Assets | Geplant | Kein aktuell unterstützter Ablauf |
| Persistente Server-/Sitzungsneustart-Erholung | Geplant | Autorität/Sitzung bleiben im Arbeitsspeicher |
| Automatisches Internet-NAT/Relay | Forschung/Zukunft | Kein WebRTC, ICE, STUN, TURN, Relay, Discovery oder automatischer NAT-Durchgang |

## Exakte physische r5-Abschlüsse

Diese Tabelle ersetzt alte Aussagen, die ursprünglichen Blocker warteten noch auf physische Prüfung.

| Issue | Ergebnis und heutige Grenze |
| --- | --- |
| [#67](https://github.com/Eun-si123/teamforge-unity-collab/issues/67) | **PASS**: legitimes gemeinsames Bearbeiten/Speichern, Guest-Unity schließen, dasselbe verifizierte Active Project öffnen und ohne `guest_handoff_mismatch` wieder verbinden. Neue/unverifizierte Identitäten bleiben durch strikte Implementierung und automatische Regressionen gesperrt |
| [#68](https://github.com/Eun-si123/teamforge-unity-collab/issues/68) | **PASS**: frischer Guest erhält autoritative Hierarchy/Transform/Lock und spätere Transform-Effekte ohne falschen geschützten Konflikt. Weitere Szenarien sinnvoll; ursprünglicher Feldblocker geschlossen |
| [#74](https://github.com/Eun-si123/teamforge-unity-collab/issues/74) | **PASS**: unterlegene Konfliktseite kehrt zum autoritativen Zustand zurück, Zusammenarbeit bleibt nutzbar. Fremdsperren-UX separat #79 |
| [#69](https://github.com/Eun-si123/teamforge-unity-collab/issues/69) | **PASS**: Launcher beim Empfang mehrfach zwangsbeendet; verifizierte Teildaten wiederverwendet, Wiederaufnahme ohne ursprünglichen CLR-/Anwendungsfehler abgeschlossen. Regressionen bei späteren Runtime-Änderungen erhalten |
| [#70](https://github.com/Eun-si123/teamforge-unity-collab/issues/70) | **TEILWEISE FÜR r5-PRODUKTZIEL / PASS FÜR STABILEN SEED**: Host Stop/Start bindet TCP `5091` erneut, realer Transfer nach Firewallfreigabe. Neue automatische Einrichtung und Port-Fallback brauchen exaktes Ersatzpaket auf realen PCs |
| [#71](https://github.com/Eun-si123/teamforge-unity-collab/issues/71) | **PASS**: langes/tiefes Ziel löst Pfadoptimierung aus, Unity öffnet und Zusammenarbeit funktioniert. Schädliche/fremde/umgeleitete Aliasse werden automatisiert fail-closed geprüft |

Zeitverläufe gehören in Issues, der aktuelle Freigabeeffekt in STATUS.

## Automatische und lokale Belege

Vor Merge von PR #81 bestand der integrierte Head die in `docs/MAIN_PATCH_STATUS_2026-08-27.md` erfassten Schutzprüfungen:

- CI #216: Server, Project Peer, Launcher-Runtime-Loader, Windows Launcher und öffentlicher Quellvertrag **PASS**.
- Dependency Review #140 **PASS**.
- Unity Tests #73: Lock Contention E2E, Realtime Authority E2E, Realtime Authority Chaos E2E, Project Transfer Resume E2E **PASS**.
- Früherer lokaler Unity Test Runner: **143/143 lokal ausführbare Tests PASS**; zwei CI-exklusive Tests mit realem Server lokal absichtlich ignoriert.
- A/B-Konflikterholung auf einer Maschine **PASS**; A/B/C-Spätbeitritt mit Hierarchy/Transform-Konvergenz **PASS**, null geschützte Konflikte im aufgezeichneten Lauf.

Neuere Änderungen wurden durch gezielte Project-Peer-/Launcher-/Unity-Tests und übliche Qualitätsprüfungen erprobt. Die Windows-Identitätssuite bestand auf unterstützten Node-22/24-Linien; der nicht verfügbare Seed-Port bestand die ganze Project-Peer-Suite in der reproduzierten Windows-Umgebung. Das stärkt Vertrauen in aktuellen Code, nicht in vor den Korrekturen veröffentlichte Bytes.

## Physische Zwei-PC-Nachweise

Basis 2026-08-22: Host→signierte Einladung→frischer Guest→Authentifizierung→direkter Transfer→Publisher-Vertrauen→verifiziertes Active→Unity-Echtzeitverbindung; Presence und beidseitiger Transform; normale Sperrkonflikte; unterstütztes Erstellen/Umbenennen/Umhängen/Geschwisterordnen/Löschen in derselben Scene. Ungespeicherter Guest-Ausstieg/Wiederöffnung stellte Hierarchy/Transform/Lock aus der laufenden Sitzung her. Coordinator-TCP-Unterbrechung führte zu Retry/automatischer Wiederverbindung ohne Unity-Neustart.

Am 2026-08-31 schloss das exakte r5-ZIP/SHA-Paar auf zwei physischen Windows-PCs die oben genannten gespeicherten Wiederverbindungen, Spätbeitritte, wiederholten Empfangsfortsetzungen, langen Pfade und Konflikterholungen. Seed `5091` Stop/Start und echter LAN-Transfer bestanden ebenfalls; neue Firewallfreigabe war damals manuell.

## Beleggrenzen

Ein Ergebnis belegt nur das Geprüfte. Quell-CI beweist kein ZIP; Unity-Automatisierung deckt nicht jede SceneView-Eingabereihenfolge, Windows-Prozesslage, LAN/Firewall-Situation oder Zweitrechner-Timing ab. Einmaschinen-Tests teilen OS, Netzwerkstack, Zeitumgebung und Hardware. r5-Feldbelege beweisen nicht späteres main. Version allein ist keine Byteidentität; exakter Dateiname/SHA-256 sind nötig. Ein geschlossener Fehler validiert nicht automatisch spätere Subsystemänderungen als Paket. Historische Aufzeichnungen gelten für ihre Momentaufnahme, ersetzen aber nicht aktuellen STATUS.

## Verbleibende Freigabebedingungen

1. r5-Abschlüsse #67/#68/#69/#71/#74 als abgeschlossen bewahren.
2. Bei Verteilung von main einen neuen unveränderlichen Kandidaten veröffentlichen.
3. Daran neue Firewalleinrichtung, engen Regelumfang/Lebenszyklus, belegten/unverfügbaren Vorzugsport-Fallback, tatsächliche Seed-Erreichbarkeit, Host Stop/Start und frischen Guest-Transfer prüfen.
4. Windows-Identitätsrettung nach Prozessverlust und weiterhin fail-closed bei mehrdeutigen/widersprüchlichen Identitäten an genau diesem Artefakt prüfen.
5. Frisch entpackter Host→frischer Guest→Echtzeit-Smoke am Ersatzpaket; r5-Belege nicht ungeprüft übernehmen.
6. Exakten Kandidatennamen/SHA/Quellidentität und ausschließlich tatsächlich ausgeführte Szenarien festhalten.
7. Installations-/Update-/Deinstallationsanleitungen verbessern und vor breiten Zuverlässigkeitsaussagen Tests/Reviews anderer Personen als des Autors einholen.

Serverprozess-Neustart ist derzeit **Trennung/fail-closed/neue Sitzung**, kein Persistenztest. Dauerhafte Autoritäts-/Sitzungswiederherstellung ist nicht implementiert.

## Zuständige Quellen

Fähigkeiten/Blocker: [englischer STATUS](STATUS.md); Versionen: [Vertrag](../release-contract.json); aktuelle/abgelöste Bytes: [builds](../builds/README.md) plus Release-SHA; Ablauf: [Funktionsweise](HOW_IT_WORKS.de.md); Zukunft: [ROADMAP](ROADMAP.md); Struktur: [architecture](architecture.md); Gründe: [architecture-decisions](architecture-decisions.md); Testszenarien: [TEST_LAB](TEST_LAB.md); Fehler: Issues; alte Tests: datierte Nachweise. Nicht übersetzte Detaildokumente bleiben englisch.
