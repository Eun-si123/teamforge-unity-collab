# Aktualny stan TeamForge

[English](STATUS.md) · [Jak to działa](HOW_IT_WORKS.pl.md)

_Przegląd dokumentacji źródłowej: 2026-09-10 UTC. Uwzględnia źródła na `main` po r5, w tym wzmocnienia sieci Windows, diagnostyki i tożsamości Project, opublikowany artefakt r5 oraz wyniki fizycznych testów dokładnie r5 z 2026-08-31. Dowody dotyczące pakietu i nowszych źródeł pozostają rozdzielone._

> **Wczesny publiczny podgląd — nie używaj TeamForge jako jedynej kopii ani jedynego sposobu odzyskania ważnego projektu Unity.** Pierwotne blokery Windows WP5.1 przeszły rozległe testy fizyczne dokładnie r5. Nowszy `main` zawiera dodatkowe zachowania sieci/tożsamości, których jeszcze nie sprawdzono razem jako jednego dokładnego pakietu zastępczego na fizycznych PC. Zachowuj kopie zapasowe i testuj głównie na projektach, które można utracić.

[English](STATUS.md) jest kanonicznym, czytelnym dla ludzi źródłem informacji o możliwościach i gotowości wydania. Inne dokumenty powinny do niego odsyłać zamiast utrzymywać konkurencyjne listy blokerów. Dokładne wybory wersji: [release-contract.json](../release-contract.json); tożsamość bajtów i zasady zastąpionych buildów: [builds/README.md](../builds/README.md); dyskusje błędów i historyczne reprodukcje: GitHub Issues. Nieprzetłumaczone dokumenty szczegółowe pozostają po angielsku.

## Stan w skrócie

- Linia produktu: `0.5.1`; linia źródeł: `0.5.1-wp5.1-path-resilience`.
- Najnowszy opublikowany kandydat pakietu: `v0.5.1-prealpha-wp5.1-r5`.
- Commit źródłowy/tag r5: `a97b6ba5649e2888b909bf3c99c64acfd7042ba6`.
- ZIP Windows: `Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r5-win-x64.zip`.
- SHA-256: `5944abf2263502ee40f49d0ac2c8a9826a809dc4cd1b20c9edf82f94ba35f8cc`.
- Cel pakietu: Windows x64; gotowość wydania: **FIELD BLOCKED** — wymagania testów terenowych nadal otwarte.
- Linia Unity: `6000.3`; zapisany Editor testowy kandydata: `6000.3.21f1`.
- Realtime Protocol, Project Transfer Protocol i Project Manifest Schema: każdy **v1**.

## Źródła a opublikowany kandydat

Pierwotne poprawki WP5.1 dla #67, #68/#74, #69, #70 i #71 scalono przez PR #81. r5 pochodzi z powyższego commita i zawiera także integrację Launcher **Save support bundle**, dodaną po r4.

2026-08-31 dokładnie r5 sprawdzono na dwóch fizycznych PC Windows: ponowne połączenie zapisanego Guest, nowy Guest dołączający późno ze snapshotem Transform, wielokrotne przerwanie odbioru/wznowienie, przekazanie długich/głębokich ścieżek przez execution alias i odzyskanie po chronionym konflikcie nieaktualnej rywalizacji o lock. Po wymaganym zezwoleniu zapory potwierdzono też Host Stop/Start z ponownym powiązaniem Seed TCP `5091` oraz rzeczywisty transfer Project do Guest.

Te scenariusze nie czekają już na pierwszy fizyczny retest r5. Nie czyni to późniejszych zmian częścią r5 ani produktu ogólnie instalowalną alphą. Twierdzenia o pakiecie dotyczą r5 i dowodów z 2026-08-31; r5 nie jest bajtowo ani behawioralnie równoważny `main`. Nie przywracaj zamkniętych scenariuszy tylko dlatego, że stare opisy nadal uznają je za oczekujące. Dystrybucja `main` wymaga nowego niezmiennego artefaktu i sprawdzenia faktycznych dodatków po r5 na tym dokładnym artefakcie.

## Późniejsze wzmocnienia nieobecne w r5

- Konfiguracja zapory Windows LAN może po wyraźnej zgodzie użytkownika i UAC tworzyć wąskie reguły wejściowe Coordinator/Seed, ograniczone do profilu Private i LocalSubnet, z uzgadnianiem/czyszczeniem reguł TeamForge. Test r5 wymagał ręcznego zezwolenia; nowa ścieżka wymaga fizycznych dowodów dokładnego pakietu.
- Zajęty/niedostępny preferowany lub domyślny port Seed, także Windows bind `EACCES`: Host ponawia raz z portem przydzielonym przez OS i ogłasza wybrany endpoint. Istnieją automatyczne testy Windows Project Peer; zachowanie jest nowsze niż r5.
- Serializacja tworzenia tożsamości Project i odzyskiwanie po awarii Windows przez aktywną blokadę named-pipe należącą do OS oraz trwałą barierę zgodności dla starszych procesów zapisujących. Testy awarii/współbieżności Windows Node 22/24 przeszły; żaden opublikowany pakiet z tą zmianą nie ma dokładnych fizycznych dowodów.
- Sprzątanie po odmowie Coordinator, anulowanie/terminy HTTP, lepszy kontekst diagnostyczny Host, logi ról klienta WebSocket i rozróżnienie zaproszeń Launcher od kodów `TF1`.

Są to fakty o źródłach/automatyzacji, nie zachowanie r5. Odzyskiwanie nieaktualnych locków tożsamości Linux/macOS też pozostaje poza tą zmianą Windows.

## Możliwości

| Obszar | Stan źródeł | Granica dowodów |
| --- | --- | --- |
| Obecność połączonych użytkowników | Zaimplementowana/sprawdzona | Podstawa na dwóch PC działała; szersze testy zewnętrzne przydatne |
| Zaznaczenie/kontekst Editor | Zaimplementowane/sprawdzone | Szersze testy zewnętrzne przydatne |
| Synchronizacja Transform | Zaimplementowana/stabilizowana | r5 późne dołączenie i odzyskanie po rywalizacji PASS; dalsza terenowa i UX weryfikacja potrzebna |
| Podstawowe lock/ownership | Zaimplementowane/stabilizowane | r5 rywalizacja/odzyskanie PASS; UX edycji przy cudzym locku: #79 |
| Hierarchy w tej samej Scene: tworzenie/usuwanie/nazwa/rodzic/kolejność | Zaimplementowane/stabilizowane | Podzbiór sprawdzony fizycznie; szersze pokrycie przydatne |
| Bootstrap Project/Collaboration Invite | Zaimplementowane/stabilizowane | r5 zapisany Guest PASS; nowsze odzyskanie tożsamości bez dowodów pakietu/terenu |
| Bezpośredni transfer P2P | Zaimplementowany/stabilizowany | r5 `5091` Stop/Start i transfer PASS; nowe zapora/porty bez terenowego dowodu pakietu zastępczego |
| Diagnostyka/UX odzyskiwania | Zaimplementowane/stabilizowane | r5 ma pakiet wsparcia chroniący prywatność; późniejsze poprawki tylko w źródłach względem r5 |
| Odporność ścieżek Windows/execution alias | Zaimplementowana/stabilizowana | r5 długie/głębokie przekazanie PASS; odmowa złośliwych/obcych aliasów to automatyczne pokrycie fail-closed |
| Component/Inspector | Planowane | Ogólne dodawanie/usuwanie Component i sync `SerializedProperty` nie są obsługiwane |
| Prefab/ogólne Asset | Planowane | Nie jest to obecnie wspierany przebieg |
| Trwałe odzyskanie po restarcie serwera/sesji | Planowane | Authority/sesja pozostają w pamięci |
| Automatyczne Internet NAT traversal/relay | Badania/przyszłość | Brak WebRTC, ICE, STUN, TURN, relay, discovery i automatycznego przechodzenia NAT |

## Fizyczne zamknięcia dokładnie r5

Tabela zastępuje dawne stwierdzenia, że pierwotne blokery nadal czekają na fizyczne sprawdzenie.

| Issue | Wynik i aktualna granica |
| --- | --- |
| [#67](https://github.com/Eun-si123/teamforge-unity-collab/issues/67) | **PASS**: prawidłowa wspólna edycja/zapis → zamknięcie Unity Guest → ponowne otwarcie tego samego zweryfikowanego Active Project → realtime bez `guest_handoff_mismatch`. Nowe/niezweryfikowane tożsamości nadal odrzuca ścisła implementacja i regresje automatyczne |
| [#68](https://github.com/Eun-si123/teamforge-unity-collab/issues/68) | **PASS**: nowy Guest otrzymał autorytatywne Hierarchy/Transform/Lock i późniejsze Transform bez fałszywego chronionego konfliktu. Więcej scenariuszy przydatne; pierwszy bloker zamknięty |
| [#74](https://github.com/Eun-si123/teamforge-unity-collab/issues/74) | **PASS**: przegrana strona rywalizacji wróciła do stanu autorytatywnego, współpraca pozostała użyteczna. UX cudzych locków osobno #79 |
| [#69](https://github.com/Eun-si123/teamforge-unity-collab/issues/69) | **PASS**: wielokrotnie wymuszono zamknięcie Launcher podczas odbioru; zweryfikowane części użyto ponownie, wznowienie zakończyło się bez pierwotnego błędu CLR/aplikacji. Zachować regresje przy przyszłych zmianach Runtime |
| [#70](https://github.com/Eun-si123/teamforge-unity-collab/issues/70) | **CZĘŚCIOWO DLA CELU r5 / PASS DLA STABILNEGO SEED**: Host Stop/Start ponownie związał TCP `5091`; prawdziwy transfer po zezwoleniu zapory. Nowe automatyczne wdrożenie i fallback portu wymagają dokładnego zastępczego pakietu na fizycznych PC |
| [#71](https://github.com/Eun-si123/teamforge-unity-collab/issues/71) | **PASS**: długa/głęboka lokalizacja uruchomiła optymalizację ścieżki, Unity się otworzył i współpraca działała. Odmowa złośliwych/obcych/przekierowanych aliasów pozostaje automatycznym fail-closed |

Szczegółowe chronologie należą do Issues, bieżący wpływ na wydanie do STATUS.

## Dowody automatyczne i lokalne

Przed scaleniem PR #81 jego końcowy zintegrowany head przeszedł bramki zapisane w `docs/MAIN_PATCH_STATUS_2026-08-27.md`:

- CI #216: Server, Project Peer, loader Runtime Launcher, Windows Launcher i kontrakt publicznych źródeł **PASS**.
- Dependency Review #140 **PASS**.
- Unity Tests #73: Unity Lock Contention E2E, Unity Realtime Authority E2E, Realtime Authority Chaos E2E, Project Transfer Resume E2E **PASS**.
- Wcześniejszy lokalny Unity Test Runner: **143/143 lokalnie wykonywalnych testów PASS**; dwa testy realnego serwera tylko dla CI celowo pominięto lokalnie.
- Odzyskanie rywalizacji A/B na jednej maszynie **PASS**; zbieżność Hierarchy/Transform przy późnym A/B/C **PASS**, zero chronionych konfliktów w zapisanym przebiegu.

Późniejsze zmiany sprawdzono testami Project Peer/Launcher/Unity i standardowymi bramkami. Suite tożsamości Windows przeszedł na wspieranych Node 22/24; regresja niedostępnego portu Seed przeszła pełny zestaw Project Peer w odtworzonym środowisku Windows. To zwiększa zaufanie do źródeł, nie tworzy dowodów dla bajtów opublikowanych przed poprawkami.

## Dowody z dwóch fizycznych PC

Podstawa 2026-08-22: Host → podpisane zaproszenie → nowy Guest → uwierzytelnienie → transfer bezpośredni → zaufanie Publisher → zweryfikowane Active → realtime Unity; Presence i dwukierunkowy Transform; zwykła rywalizacja locków; tworzenie/nazwa/rodzic/kolejność rodzeństwa/usuwanie w jednej Scene. Wyjście/powrót Guest bez zapisu odtwarzały Hierarchy/Transform/Lock z nadal działającej sesji. Przerwanie TCP Coordinator → retry → automatyczne połączenie bez restartu Unity.

2026-08-31 dokładna para ZIP/SHA r5 zamknęła wskazane scenariusze na dwóch fizycznych PC Windows. Seed `5091` Stop/Start i realny transfer LAN też przeszły; pierwsze zezwolenie zapory było wtedy nadal ręczne.

## Granice dowodów

Wynik dowodzi tylko tego, co wykonano. CI źródeł nie dowodzi poprawności ZIP. Automatyzacja Unity nie odtwarza każdego porządku wejścia SceneView, stanu procesów Windows, LAN/zapory czy czasu drugiej maszyny. Jedna maszyna oznacza wspólny OS, stos sieciowy, warunki czasowe i sprzęt. r5 nie dowodzi późniejszego `main`. Wersja nie jest tożsamością bajtów; potrzebne są dokładne nazwa/SHA-256 artefaktu. Zamknięty błąd nie daje automatycznie dowodu pakietowego/terenowego późniejszym zmianom podsystemu. Historia obowiązuje dla swoich snapshotów, nie zastępuje obecnego STATUS.

## Pozostałe warunki wydania

Przed promowaniem ogólnie instalowalnej alphy:

1. Zachować fizyczne zamknięcia r5 #67/#68/#69/#71/#74 jako ukończone.
2. Jeśli dystrybuowany będzie `main`, opublikować nowy niezmienny kandydat.
3. Na tym dokładnym zamienniku sprawdzić nową konfigurację zapory, wąski zakres/cykl reguł, fallback zajętego/niedostępnego portu, rzeczywistą osiągalność ogłoszonego Seed, Host Stop/Start i nowy transfer Guest.
4. Sprawdzić odzyskanie tożsamości Windows po utracie procesu, bezpieczny restart i dalsze fail-closed przy niejednoznacznych/sprzecznych tożsamościach na tym artefakcie.
5. Wykonać smoke świeżo rozpakowany Host → nowy Guest → realtime na zamienniku; nie dziedziczyć dowodów r5 przez założenie.
6. Zapisać dokładną nazwę/SHA/tożsamość źródeł i wyłącznie wykonane scenariusze.
7. Rozwijać instrukcje instalacji/aktualizacji/usuwania i uzyskać testy/recenzje osób innych niż twórca przed szerokimi twierdzeniami o niezawodności.

Restart procesu serwera to obecnie **rozłączenie/fail-closed/odzyskanie przez nową sesję**, nie test trwałości: trwałe odzyskanie authority/sesji po restarcie nie jest zaimplementowane.

## Właściciele informacji

Możliwości/blokery: [English](STATUS.md); wersje: [kontrakt](../release-contract.json); obecne/zastąpione bajty: [builds](../builds/README.md) + SHA Release; przebieg: [Jak to działa](HOW_IT_WORKS.pl.md); plany: [ROADMAP](ROADMAP.md); struktura: [architecture](architecture.md); powody: [architecture-decisions](architecture-decisions.md); scenariusze: [TEST_LAB](TEST_LAB.md); błędy: Issues; dawne testy: datowane zapisy. Szczegóły bez tłumaczenia pozostają angielskie.
