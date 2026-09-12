# Wie TeamForge funktioniert

Diese Seite erklärt, **was beim Hosten, Beitreten, Projekttransfer, Bearbeiten einer Scene, Trennen oder Wiederherstellen nach Fehlern geschieht**. Sie ist eine geführte Erklärung, keine vollständige Protokollspezifikation oder Quellcodedateikarte.

Aktuelle Fähigkeiten/Blocker: [Status](STATUS.de.md); Topologie und Vertrauensgrenzen: [architecture](architecture.md); Dateien: [CODEMAP](../CODEMAP.md); Entscheidungsgründe: [architecture-decisions](architecture-decisions.md). Nicht übersetzte Detailquellen bleiben englisch. Das [englische Original](HOW_IT_WORKS.md) bestimmt die Bedeutung.

## Das 60-Sekunden-Modell

Zwei bewusst getrennte Datenwege:

- Host-/Guest-Unity-Editor senden Echtzeitoperationen per WebSocket an die Session Authority des Servers.
- Host Unity nutzt Host Project Peer/Seed, Guest Launcher nutzt Guest Project Peer. Peers übertragen Projektdaten direkt per HTTP; der Guest Peer übergibt ein verifiziertes Active-Projekt an Guest Unity.
- Server koordiniert signierte Metadaten mit beiden Peers, wird aber nicht zum Projektdatei-Relay.
- Guest öffnet Inhalte erst nach Vertrauen-, Integritäts-, Aktivierungs- und Unity-Übergabeprüfungen.

So bleiben große Transfers vom latenzempfindlichen Echtzeitverkehr getrennt, mit einer eindeutigen Echtzeitautorität.

## Hauptprozesse

### Unity-Editor-Paket

Es liefert Host-Ablauf, Verbindungslebenszyklus, Presence, unterstützte Transform/Lock- und gleiche-Scene-Hierarchy-Zusammenarbeit, Diagnose-/Wiederherstellungsanzeige und Anwendung genehmigter entfernter Zustände auf die lokale Scene. Der Client **beobachtet Autorität**. Ein lokaler Wert wird nicht allein durch seine Existenz in einem Editor autoritativ.

### TeamForge Server

**Session Authority** verwaltet Mitgliedschaft, gemeinsame Revision/Reihenfolge, Locks/Leases, gespeicherten unterstützten Scene-Zustand, Replay-/Idempotenzschutz und Echtzeiteffekte. **Project Coordinator** verwaltet signierte Projekt-/Publisher-/Baseline-/Peer-Koordinationsmetadaten. Der Server speichert oder vermittelt nicht die normalen Manifest/File/Chunk-Nutzdaten.

### Project Peer

Verantwortlich für signierte Einladungsprüfung, deterministische Manifeste/Hashes, direktes HTTP, verifizierte Wiederaufnahme, Staging, unveränderliche Active-Revisionen, Dateisystem-/Pfadsicherheit und Projekt-/Publisher-Vertrauen. Ein erfolgreicher Download allein aktiviert nichts; die vollständige Prüf- und Vertrauenskette muss bestehen.

### Windows Guest Launcher

Ein neuer Guest startet außerhalb von Unity, weil noch kein Projekt vorliegen muss. Launcher prüft enthaltenen Runtime, Einladung und Vertrauen, empfängt per Peer, prüft endgültiges Active und benötigte Unity-Version und übergibt an Unity. Normale Paket-Guests müssen System-Node.js/npm nicht installieren oder manuell bedienen.

Aktueller Launcher-Code kann ein **manuelles lokales Supportpaket** erzeugen: begrenztes, um sensible Daten bereinigtes Beobachtungs-ZIP. Kein automatischer Upload, keine Autoritätsvergabe und keine Umgehung von Einladung, Vertrauen, Aktivierung, Runtime, Pfad oder Unity-Übergabe. Ob ein Paket diese Aktion enthält, hängt vom exakten Artefakt ab; [Status](STATUS.de.md) und [builds](../builds/README.md) trennen Quelle und Veröffentlichung.

## Host startet Zusammenarbeit

1. **Publish & Start** auswählen.
2. Unity prüft lokales Projekt und gespeicherte Scene-Voraussetzungen.
3. Peer erzeugt eine deterministische Baseline; Dateien/Chunks erhalten Integritätsidentitäten.
4. Host Peer startet den direkten Transfer-Seed.
5. Projekt/Publisher/Baseline/Peer-Metadaten werden mit Server koordiniert.
6. Eine signierte Collaboration Invite entsteht; Host ist bereit für Guests.

Weitere fail-closed-Prüfungen sind vorhanden. **Host Ready heißt mehr als ein offener Port**: Transfer- und Sitzungsverträge des Guest-Ablaufs sind hergestellt. Die Einladung soll weder Zugangscode, privaten Signaturschlüssel noch beliebigen lokalen Projektpfad transportieren. Ein verwendeter Zugangscode wird separat geteilt.

## Neuer Guest tritt bei

1. Windows Guest Launcher öffnen, enthaltenen Runtime prüfen.
2. Einladung laden/einfügen, Struktur und Signatur prüfen.
3. Identität und Vertrauen von Project/Owner/Publisher prüfen.
4. Koordinierten Host/Seed kontaktieren, Descriptor/Manifest/Inventory erhalten.
5. Nur benötigte Chunks laden; Chunk-, Datei-, Manifest- und Projektintegrität prüfen.
6. Im Staging aufbauen und vollständigen Kandidaten prüfen.
7. Unveränderliche Active-Revision erzeugen und kleinen Current-Project-Zeiger umstellen.
8. Benötigte Unity-Programmdatei und endgültige Übergabe prüfen, verifiziertes Projekt öffnen.

Ein beliebiges halb heruntergeladenes Verzeichnis gilt nicht als aktuelles Projekt. Die vorige verifizierte Active-Revision kann beim Empfang einer neuen Revision oder gescheiterter Aktivierung bestehen bleiben.

### Verifizierungsbewusste Wiederaufnahme

Nach Abbruch dürfen bereits verifizierte Inhalte dort wiederverwendet werden, wo der Transfervertrag es erlaubt. Das heißt nicht, beliebigen vorhandenen Dateien zu vertrauen: Hashes und Aktivierungsvertrag bleiben maßgeblich.

## Unterstütztes Scene-Objekt bearbeiten

1. Nutzer bewegt GameObject; Unity-Transform-Dienst erkennt die Änderung.
2. Autoritätskanonische Objektidentität auflösen.
3. Lock/Lease und aktuelle Verbindungsautorität prüfen; Transform-Operation per WebSocket senden.
4. Server prüft Operation und wendet Reihenfolge, Revision und Idempotenz an.
5. Genehmigten Effekt an andere Clients senden.
6. Empfänger aktualisiert Authority View; Unity wendet genehmigten entfernten Transform sicher an.

**Identität:** Beide Editor müssen dasselbe **logische Objekt** meinen, nicht nur gleichen Namen oder Hierarchy-Pfad. Gespeicherte Scene-Objekte verwenden stabile Unity-Identität; unterstützte sitzungserzeugte Objekte erhalten nach autoritativer Bindung TeamForge-Identität. Mehrdeutigkeit führt zu fail-closed statt Raten anhand Name, Geschwisterindex oder Pfad.

**Autorität:** Server entscheidet über akzeptierten gemeinsamen Echtzeitzustand. Clients melden Absicht und wenden genehmigte Ergebnisse an, ohne konkurrierende Wahrheiten.

**Revision/Reihenfolge:** Akzeptierte Operationen erhöhen die gemeinsame Ordnung. Revisionen erklären veraltete Zustände, späte Beitritte, Replay und ob eine Operation gegen den erwarteten gemeinsamen Zustand geprüft wurde.

**Lock/Lease:** Autoritätskontrollierte Sperren verhindern stilles gleichzeitiges Überschreiben. Verschwindet ein Client, laufen Leases aus, statt dauerhaft zu bleiben.

**Replay/Idempotenz:** Ein legitimer Retry derselben Operation unterscheidet sich von einer anderen Operation mit wiederverwendeter Identität. Doppelte Zustellung darf nicht doppelt mutieren.

## Hierarchy-Änderungen

Erstellen/Löschen/Umbenennen/Umhängen/Geschwisterordnung in derselben Scene nutzen einen eigenen Autoritätspfad, keine vorgetäuschten Transform-Änderungen. Transform hängt von Struktur ab: andere Eltern/Identitäten können trotz gleicher lokaler Zahlen andere Scenes erzeugen. Allgemeine Component-/Inspector-/Prefab-/Asset-Synchronisierung oder beliebige Cross-Scene-Strukturen folgen daraus nicht; siehe [Status](STATUS.de.md).

## Wiederverbindung und Verbindungsepochen

Wiederverbindung beweist keine Gültigkeit alter Autorität. Ablauf: Verbindung verlieren, verbindungsgebundener Autorität nicht mehr vertrauen, Reconnect/Handshake, aktuelle ausgehandelte Fähigkeiten und autoritativen Zustand empfangen, unterstützte Objektbindung für neue Epoche erneuern, erst bei vollständigem benötigtem Zustand fortsetzen. Gespeicherte Aliasse oder Identitätscaches helfen bei Auflösung, vergeben aber selbst keine Autorität.

## Fehler und Wiederherstellung

Verifizierter Zustand wird bewahrt statt Unbekanntes zu erzwingen:

- beschädigter Runtime: vor Ausführung ungeprüften Codes stoppen;
- ungültige/widersprüchliche Einladung: bestehende Projektbindung unverändert lassen;
- Transferfehler: erlaubten verifizierten Fortschritt erhalten;
- Aktivierungsfehler: vorheriges verifiziertes Active nicht ersetzen;
- Unity-Pfadproblem: nur separat validierte TeamForge-eigene Pfadstrategie;
- Baseline-/Identitätskonflikt: Abgleich/Update fordern statt raten;
- unbekannter Prozess auf benötigtem Port: nicht beenden, nur weil TeamForge den Port möchte.

Wiederherstellung ist **zustandsabhängig**. Retry, Paste New Invite, Use Latest Project, Open Existing Verified Project und Choose Unity erscheinen nur bei definierter sicherer Bedeutung.

**Diagnose ist Beobachtung, keine Wiederherstellungsautorität.** Kopierte Diagnose oder manuelles ZIP beschreiben den Lauf. Speichern ändert weder Project-Auswahl, Retry, Publisher-Vertrauen, Aktivierung noch Sicherheitsprüfungen. Es erfasst einen begrenzten sicheren Zustandsausschnitt statt umfangreicher Projekt-/Maschinendaten; vor öffentlichem Teilen trotzdem prüfen.

## Warum zwei Datenwege?

Echtzeitkollaboration benötigt kleine geordnete Autoritätsnachrichten. Projektstart umfasst viele Dateien, große Datenströme, Retries, Resume, Hashes, Staging und Datenträgerarbeit. Die Trennung vermeidet einen versteckten Serverengpass und macht Sicherheits-/Fehlergrenzen verständlicher.

Dafür muss Guest den Host Peer tatsächlich erreichen. Gleicher PC, erreichbare LAN oder verwaltete VPN passen dazu. Automatische Internet-Discovery/NAT/Relay sind eine eigene zukünftige Transportaufgabe, keine implizite P2P-Zusage.

## Speicherorte und Lebensdauer

| Zustand | Ort/Lebensdauer |
| --- | --- |
| Session Authority | Serverarbeitsspeicher der laufenden Sitzung |
| Projektkoordination | Serverarbeitsspeicher |
| Client Authority View | Aktuelle Unity-Verbindung |
| Transferinhalt/Staging | Verwalteter Project-Peer-Speicher |
| Verifizierte Active-Revisionen | Dauerhafter verwalteter Projektspeicher |
| Aktueller Active-Zeiger | Kleine dauerhafte Metadaten |
| Launcher-Diagnosehistorie | Begrenzter aktueller Lauf |
| Manuelles Supportpaket | Nutzererstelltes lokales begrenztes/bereinigtes ZIP; kein automatischer Upload |

Ein dauerhaft heruntergeladenes Projekt bedeutet keine dauerhafte Autoritätshistorie; ein Diagnoseartefakt wird nicht zur Autorität. Das ist für Neustart, Reconnect, Resume und Erholung entscheidend.

## Dem Verhalten in den Code folgen

Exakte Dateinamen/Tests pflegt [CODEMAP](../CODEMAP.md), damit diese Erklärung Refactorings übersteht. Typische Pfade: Verbindung → Unity `TeamForgeConnectionService` + Server-WebSocket-Host; Transform/Lock → Transform-Dienst + Authority View + Session Authority; Hierarchy → Unity-Dienst + Server-Hierarchy/Session Authority; Transfer → Peer-Host/Guest-Orchestratoren + direkte Quelle + Content Store; Guest-Start/Erholung → Windows Launcher + Launcher Core + Guest-Orchestrator; Support → Diagnose-UI + Core-Bundle/Bereinigung; Pfadrobustheit → Launcher Core + gemeinsamer Project-Peer-Vertrag.
