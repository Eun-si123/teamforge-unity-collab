# TeamForge-Kompatibilität

Diese Seite beschreibt **Kompatibilitäts- und Topologiegrenzen für Leser**.

- Genaue aktuelle Produkt-, Runtime- und Protokollauswahl → [`../release-contract.json`](../release-contract.json)
- Aktuelle Validierung und Reife → [STATUS.md](STATUS.md)
- Identität des gepackten Artefakts → [`../builds/README.md`](../builds/README.md) + exakter Release-SHA-256

Kopiere häufig wechselnde Tool- oder Runtime-Patchnummern nicht in mehrere Dokumente. Der Release-Vertrag verwaltet diese genauen Festlegungen.

## Vor dem Testen

Verwende ein entbehrliches Projekt und bewahre Backups auf: TeamForge ist eine frühe öffentliche Vorschau. [STATUS.md](STATUS.md) verwaltet die aktuellen Grenzen der Feldvalidierung. Die Plattformtabelle unten unterscheidet das Paket-Ziel von den Anforderungen für Quellcode und Build.

Mindestanforderungen an CPU, RAM, GPU, Speicherplatz, Bandbreite und Latenz wurden noch nicht durch kontrollierte Tests ermittelt. Ein erfolgreicher Prototyplauf ist keine Empfehlung für Mindesthardware.

Guests müssen den konfigurierten Server und den vom Host bekannt gegebenen Project Peer-Endpunkt erreichen können. Eine signierte Einladung schafft keine Netzwerkerreichbarkeit. Nutze denselben Rechner, ein erreichbares LAN oder ein verwaltetes VPN; automatische Internet-Traversierung und Relay werden nicht bereitgestellt.

## Produkt- und Protokollkompatibilität

Die TeamForge-Komponenten sollen als eine kompatible Produktlinie weiterentwickelt werden. Server-, Project Peer-, Launcher- und Paketversionen sollen nicht unabhängig gemischt werden.

Die aktuelle Architektur trennt:

- die Autorität für Echtzeit-Zusammenarbeit über den konfigurierten TeamForge Server WebSocket;
- Projektübernahme und Metadatenkoordination;
- direkte Project Peer-Nutzdatenübertragung;
- die Integrität von gepacktem Host/Guest Runtime und Launcher.

Protokoll- und Schemaversionen sind nur dann additiv kompatibel, wenn die vorhandene Semantik kompatibel bleibt. Die genauen gewählten Protokoll- und Schemanummern gehören in `release-contract.json`.

Mische keine generierten Runtime/Launcher-Manifeste oder Binärdateien verschiedener Paketkandidaten, nur weil dieselbe Produktversion angezeigt wird.

## Unity-Kompatibilität

Die aktuell unterstützte Unity-Produktlinie ist **Unity 6000.3**.

Ein bestimmter Editor-Patch gilt erst dann als validiert, wenn dokumentierte Nachweise für den vorgesehenen Quellstand oder Kandidaten vorliegen. Betrachte den neuesten verfügbaren Unity-Patch nicht automatisch als getestet oder unterstützt.

Die exakt dokumentierte Test-Editor-Auswahl steht in `release-contract.json`; aktuelle Nachweise fasst [STATUS.md](STATUS.md) zusammen.

## Entwicklungs- und Runtime-Kompatibilität

Entwickler am Quellcode sollten die Node/npm/.NET/Tool-Bereiche aus `release-contract.json` und der Lock-/Build-Konfiguration des Repositorys verwenden.

Dies sind **Quellcode-/Build-Anforderungen**, keine gewöhnlichen Installationsanforderungen für Endnutzer des gepackten Host/Guest-Ablaufs. Dieser verwendet gemäß aktuellem Release-Vertrag gebündelte oder eigenständige Runtime-Komponenten.

Eine neue Runtime- oder Toolchain-Hauptversionsfamilie braucht eine bewusste Kompatibilitätsentscheidung und Validierung. Eine erfolgreiche Installation auf einem Rechner reicht nicht als Ableitung.

## Unterstützte Topologie

Derzeit unterstützt oder vorgesehen:

- konfigurierter TeamForge Server WebSocket für Echtzeit-Autorität;
- direkte Project Peer-HTTP-Übertragung auf demselben PC, in einem erreichbaren LAN oder verwalteten VPN;
- expliziter reiner Loopback-Modus auf demselben PC;
- authentifiziertes Lauschen außerhalb von Loopback mit einer konkreten, dem Guest bekannt gegebenen Hostadresse;
- gepackter Windows-Host/Guest-Ablauf mit einer geprüften gebündelten Runtime.

Derzeit nicht als unterstützte Topologie bereitgestellt:

- WebRTC / RTCDataChannel;
- ICE / STUN / TURN;
- automatische NAT-Traversierung;
- Relay / automatischer Transport-Fallback;
- automatische Peer-Erkennung;
- serverlose oder eingebettete Echtzeit-Autorität;
- Bereitstellung im nicht vertrauenswürdigen öffentlichen Internet mit vollständigem System für Benutzeridentität und Autorisierung.

`P2P` bedeutet in der aktuellen TeamForge-Dokumentation **direkte Project Peer-Nutzdatenübertragung**, keine automatische Internet-P2P-Verbindung.

## Plattformtabelle

| Bereich | Kompatibilitätsstatus |
| --- | --- |
| Windows x64 gebündelte Runtime / Guest Launcher | Aktuelle Plattformrichtung der Pakete; der genaue Kandidat unterliegt weiterhin den Feldprüfungen in STATUS |
| Unity 6000.3 | Aktuelle Unity-Produktlinie |
| Exakt dokumentierter Unity-Patch | Siehe `release-contract.json` + STATUS-Nachweise |
| Andere Unity 6000.3-Patches | Separate Neubasierung/Validierung nötig, bevor sie als getestet bezeichnet werden |
| Eigenständiger macOS/Linux-Launcher | Nicht als gleichwertiger aktueller Kandidat gepackt |
| Docker/Compose | Quellcode-/Serveroption, nicht der normale gepackte Host-Ablauf oder aktuelle Release-Prüfbedingung |
| Authenticode | Verteilungs-/Signaturstatus gehört in STATUS und die aktuelle Artefaktdokumentation |

## Verwalteter Windows-Speicher im aktuellen Quellcode

Der aktuelle Quellcode erfordert unter Windows ein lokales festes NTFS/ReFS-Verwaltungsverzeichnis für die Projektidentitätssperre. Netzwerkverzeichnisse sowie nicht verfügbare oder nicht geprüfte Wurzeln werden abgewiesen. Dies betrifft TeamForges verwalteten Speicher und ist keine neue allgemeine Anforderung für Unity-Projekte. Die Grenze zwischen Quellcode und veröffentlichtem Kandidaten steht in [STATUS.md](STATUS.md); siehe auch die [zuständige Implementierung](../project-peer/src/project-identity-lock.mjs).

## Kompatibilitätsaussagen und Verlauf

Historische Phasen-, Arbeitsstands- und Testberichte gelten für den aufgezeichneten Quellstand oder das Artefakt. Sie sind nicht allein deshalb aktuelle Kompatibilitätsnachweise, weil die angezeigte Produktversion der aktuellen Linie ähnelt.

Wenn die exakte Byte-Identität zählt, nutze Release-Asset-Dateiname + SHA-256 statt nur der Produktversion.
