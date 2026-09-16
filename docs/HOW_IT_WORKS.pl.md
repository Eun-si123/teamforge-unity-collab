# Jak działa TeamForge

Ta strona wyjaśnia, **co dzieje się przy hostowaniu, dołączaniu, przesyłaniu projektu, edycji Scene, rozłączeniu i odzyskiwaniu po błędzie**. Jest objaśnieniem przebiegu, nie pełną specyfikacją protokołu ani mapą źródeł.

Możliwości/blokery: [Stan](STATUS.pl.md); topologia/zaufanie: [architecture](architecture.md); pliki: [CODEMAP](../CODEMAP.md); uzasadnienia: [architecture-decisions](architecture-decisions.md). Szczegóły bez tłumaczenia pozostają angielskie; [English](HOW_IT_WORKS.md) rozstrzyga znaczenie.

## Model w 60 sekund

Dwie celowo oddzielne drogi danych:

- Unity Editor Host/Guest wysyłają operacje realtime przez WebSocket do Session Authority Server.
- Host Unity korzysta z Host Project Peer/Seed, Guest Launcher z Guest Project Peer. Peer przesyłają zawartość projektu bezpośrednio przez HTTP; Guest Peer przekazuje zweryfikowane Active do Guest Unity.
- Server koordynuje z oboma podpisane metadane, nie jest relayem plików projektu.
- Guest otwiera zawartość dopiero po sprawdzeniu zaufania, integralności, aktywacji i przekazania do Unity.

Duże transfery pozostają oddzielone od wrażliwej na opóźnienia współpracy, przy jednej jednoznacznej władzy nad stanem realtime.

## Główne procesy

### Pakiet Unity Editor

Zapewnia Host, cykl połączenia, Presence, obsługiwane Transform/Lock i Hierarchy jednej Scene, diagnostykę/odzyskiwanie i nakładanie zatwierdzonego stanu zdalnego. Klient **obserwuje autorytet**: lokalna wartość nie staje się autorytatywna tylko dlatego, że istnieje w jednym Editor.

### TeamForge Server

**Session Authority**: członkostwo, wspólna rewizja/kolejność, lock/lease, zachowany obsługiwany stan Scene, ochrona replay/idempotencji i efekty realtime. **Project Coordinator**: podpisane metadane Project/Publisher/baseline/Peer. Server nie przechowuje ani nie przekazuje zwykłej zawartości Manifest/File/Chunk.

### Project Peer

Odpowiada za podpisane zaproszenia, deterministyczne manifesty/hashe, bezpośredni HTTP, zweryfikowane wznowienie, staging, niezmienne rewizje Active, bezpieczeństwo systemu plików/ścieżek i zaufanie Project/Publisher. Sam udany download nie aktywuje projektu; pełna ścieżka weryfikacji i zaufania musi przejść.

### Windows Guest Launcher

Nowy Guest zaczyna poza Unity, bo może jeszcze nie mieć projektu. Launcher weryfikuje dołączony Runtime, zaproszenie i zaufanie, odbiera przez Peer, sprawdza końcowe Active oraz wymaganą wersję Unity i przekazuje do Unity. Zwykły Guest pakietowy nie musi instalować ani ręcznie obsługiwać systemowego Node.js/npm.

Obecne źródła Launcher mogą też utworzyć **ręczny lokalny pakiet wsparcia**: ograniczony ZIP obserwacyjny z usuniętymi danymi wrażliwymi. Bez automatycznego wysyłania, nadawania authority i omijania kontroli zaproszenia, zaufania, aktywacji, Runtime, ścieżek czy Unity. Dostępność w pakiecie zależy od dokładnego artefaktu; [Stan](STATUS.pl.md) i [builds](../builds/README.md) rozdzielają źródła/pakiety.

## Host rozpoczyna współpracę

1. Wybiera **Publish & Start**.
2. Unity sprawdza lokalny projekt i wymagania zapisanej Scene.
3. Peer tworzy deterministyczną baseline; pliki/chunki otrzymują tożsamości integralności.
4. Host Peer uruchamia Seed transferu bezpośredniego.
5. Metadane Project/Publisher/baseline/Peer są koordynowane z Server.
6. Powstaje podpisana Collaboration Invite; Host jest gotowy na Guest.

Istnieją dodatkowe kontrole fail-closed. **Host Ready to więcej niż otwarty port**: ustalono kontrakty transferu i sesji potrzebne Guest. Zaproszenie nie ma przenosić kodu dostępu, prywatnego klucza podpisu ani dowolnej lokalnej ścieżki. Kod dostępu, jeśli używany, udostępnia się osobno.

## Nowy Guest dołącza

1. Otwiera Windows Guest Launcher, weryfikuje dołączony Runtime.
2. Ładuje/wkleja zaproszenie; sprawdza strukturę i podpis.
3. Sprawdza tożsamość/zaufanie Project/Owner/Publisher.
4. Łączy się z koordynowanym Host/Seed; odbiera descriptor/manifest/inventory.
5. Pobiera tylko potrzebne chunki; sprawdza integralność chunków, plików, manifestu, projektu.
6. Buduje w staging i weryfikuje pełnego kandydata.
7. Tworzy niezmienną rewizję Active; przesuwa mały wskaźnik bieżącego projektu.
8. Weryfikuje wymagany plik wykonywalny Unity i końcowe przekazanie; otwiera zweryfikowany projekt.

Dowolny częściowo pobrany katalog nie staje się bieżącym projektem. Poprzednie zweryfikowane Active może pozostać dostępne podczas odbioru nowej rewizji albo nieudanej aktywacji.

### Wznowienie uwzględnia weryfikację

Zweryfikowaną zawartość można wykorzystać ponownie tam, gdzie pozwala kontrakt. Nie oznacza to zaufania dowolnemu plikowi na dysku: hashe i kontrakt aktywacji nadal rozstrzygają.

## Edycja obsługiwanego obiektu Scene

1. Użytkownik przesuwa GameObject; usługa Transform Unity obserwuje zmianę.
2. Rozwiązuje kanoniczną według authority tożsamość obiektu.
3. Sprawdza lock/lease i authority połączenia; wysyła Transform przez WebSocket.
4. Server sprawdza operację, stosuje kolejność/rewizję/idempotencję.
5. Rozsyła zatwierdzony efekt do innych klientów.
6. Odbiorca aktualizuje Authority View; Unity bezpiecznie nakłada zatwierdzony zdalny Transform.

**Tożsamość:** oba Editor muszą wskazywać ten sam obiekt logiczny, nie tylko taką samą nazwę/ścieżkę Hierarchy. Zapisane obiekty Scene używają stabilnej tożsamości Unity; obsługiwane obiekty sesji mogą otrzymać tożsamość TeamForge po autorytatywnym powiązaniu. Niejednoznaczność kończy się fail-closed, nie zgadywaniem z nazwy, indeksu rodzeństwa czy ścieżki.

**Authority:** Server ustala zaakceptowany wspólny stan realtime. Klienci przekazują zamiary i stosują wyniki, nie utrzymują konkurencyjnych prawd.

**Rewizja/kolejność:** zaakceptowane operacje przesuwają wspólny porządek. Rewizje pomagają oceniać nieaktualność, późne dołączenie, replay i zgodność stanu użytego do oceny z oczekiwanym.

**Lock/lease:** kontrolowane przez authority zapobiegają cichemu jednoczesnemu nadpisaniu. Lease wygasa po zniknięciu klienta, nie staje się trwałym lockiem.

**Replay/idempotencja:** prawidłowe ponowienie tej samej operacji odróżnia się od innej operacji używającej tej samej tożsamości. Podwójna dostawa nie może podwójnie zmienić stanu.

## Zmiany Hierarchy

Tworzenie/usuwanie/nazwa/rodzic/kolejność rodzeństwa w tej samej Scene mają osobną ścieżkę authority, nie udają Transform. Transform zależy od struktury: inne rodzicielstwo/tożsamość mogą dać różne Scene przy tych samych liczbach lokalnych. Nie wynika z tego ogólne wsparcie Component/Inspector/Prefab/Asset lub dowolnych struktur między Scene; zobacz [Stan](STATUS.pl.md).

## Ponowne połączenie i epoki

Reconnect nie dowodzi aktualności starej authority: utrata połączenia → przestań ufać authority połączenia → reconnect/handshake → aktualne wynegocjowane możliwości i stan autorytatywny → ponowne powiązanie obiektów dla nowej epoki → wznowienie dopiero po przygotowaniu wymaganego stanu. Trwałe aliasy/cache tożsamości mogą pomagać w rozwiązywaniu, lecz same nie nadają authority.

## Błędy i odzyskiwanie

Zachowuj stan zweryfikowany zamiast wymuszać nieznany:

- uszkodzony Runtime: zatrzymaj przed wykonaniem niezweryfikowanego kodu;
- nieprawidłowe/sprzeczne zaproszenie: pozostaw istniejące powiązanie Project;
- błąd transferu: zachowaj dozwolony zweryfikowany postęp;
- błąd aktywacji: nie zastępuj poprzedniego zweryfikowanego Active;
- problem ścieżki Unity: tylko osobno zweryfikowana strategia ścieżek TeamForge;
- niezgodność baseline/tożsamości: wymagaj uzgodnienia/aktualizacji, nie zgaduj;
- nieznany proces na potrzebnym porcie: nie zabijaj go dlatego, że TeamForge chce port.

Odzyskiwanie **zależy od stanu**. Retry, Paste New Invite, Use Latest Project, Open Existing Verified Project, Choose Unity są oferowane tylko tam, gdzie mają określone bezpieczne znaczenie.

**Diagnostyka obserwuje, nie nadaje uprawnień do odzyskiwania.** Kopia diagnostyki i ręczny ZIP opisują przebieg. Zapis nie zmienia Project, nie ponawia operacji, nie ufa Publisher, nie aktywuje zawartości ani nie osłabia kontroli. Zbiera ograniczony bezpieczny obraz stanu zamiast szerokich danych projektu/maszyny; nadal wymaga sprawdzenia przed publicznym udostępnieniem.

## Dlaczego transfer i realtime są osobne

Realtime korzysta z małych uporządkowanych komunikatów authority. Bootstrap obejmuje wiele plików, duże strumienie, ponowienia, wznowienia, hashe, staging i dysk. Rozdzielenie zapobiega ukrytemu wąskiemu gardłu Server i ułatwia rozumienie bezpieczeństwa/błędów.

Koszt: Host Peer musi być rzeczywiście osiągalny dla Guest. Nadaje się ten sam PC, osiągalny LAN lub zarządzany VPN. Automatyczne Internet discovery/NAT traversal/relay to osobny przyszły problem transportu, nie obietnica ukryta w słowie P2P.

## Miejsce i czas życia stanu

| Stan | Właściciel/czas życia |
| --- | --- |
| Realtime Session Authority | Pamięć Server żywej sesji |
| Rejestr koordynacji Project | Pamięć Server |
| Authority View klienta | Bieżące połączenie Unity |
| Zawartość transferu/staging | Zarządzany magazyn Project Peer |
| Zweryfikowane rewizje Active | Trwały zarządzany magazyn Project |
| Bieżący wskaźnik Active | Małe trwałe metadane |
| Historia diagnostyki Launcher | Ograniczony bieżący przebieg |
| Ręczny pakiet wsparcia | Lokalny ograniczony/oczyszczony ZIP użytkownika; bez automatycznego wysyłania |

Trwały pobrany projekt nie oznacza trwałej historii authority realtime, a artefakt diagnostyczny nie staje się authority. To ważne przy restartach, reconnect, wznowieniu i odzyskiwaniu.

## Od zachowania do kodu

Dokładne pliki/testy utrzymuje [CODEMAP](../CODEMAP.md). Typowe ścieżki: połączenie → Unity `TeamForgeConnectionService` + host WebSocket Server; Transform/Lock → usługa Transform + Authority View + Session Authority; Hierarchy → usługa Unity + model Hierarchy Server/Session Authority; bootstrap/transfer → orkiestratory Host/Guest Peer + źródło bezpośrednie + content store; start/odzyskanie Guest → Windows Launcher + Launcher Core + orkiestrator Guest; wsparcie → UI diagnostyczne + pakiet/usuwanie danych Core; odporność ścieżek → Launcher Core + wspólny kontrakt Project Peer. Mapa kodu zamiast powielania nazw plików zachowuje użyteczność wyjaśnienia po refaktoryzacji.
