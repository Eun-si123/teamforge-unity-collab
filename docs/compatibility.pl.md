# Zgodność TeamForge

Ta strona opisuje **granice zgodności i topologii dla czytelnika**.

- Dokładne wybory produktu/runtime/protokołu → [`../release-contract.json`](../release-contract.json)
- Bieżąca walidacja/gotowość → [STATUS.md](STATUS.md) (angielski)
- Tożsamość pakietu → [`../builds/README.md`](../builds/README.md) + dokładny SHA-256 Release

Nie powielaj często zmieniających się numerów poprawek narzędzi/runtime; określa je kontrakt wydania.

## Przed testem

Używaj projektu, który można usunąć, i kopii zapasowych. TeamForge to wczesna publiczna wersja poglądowa; [STATUS.md](STATUS.md) określa granice testów terenowych. Macierz oddziela platformę pakietu od wymagań źródeł/budowania.

Minimalne wymagania CPU, RAM, GPU, dysku, przepustowości i opóźnień nie zostały ustalone w kontrolowanych testach. Udane uruchomienie prototypu nie jest zaleceniem minimalnego sprzętu.

Guest musi mieć dostęp do skonfigurowanego Server i punktu Project Peer ogłaszanego przez Host. Podpisane zaproszenie nie zapewnia osiągalności sieciowej. Użyj tego samego komputera, osiągalnego LAN lub zarządzanego VPN; brak automatycznego przechodzenia przez Internet i relay.

## Produkt i protokół

Komponenty rozwijają się jako zgodna linia produktu; nie mieszaj dowolnie wersji Server/Project Peer/Launcher/pakietu. Architektura oddziela:

- autorytet współpracy w czasie rzeczywistym przez WebSocket skonfigurowanego Server;
- koordynację inicjalizacji projektu i metadanych;
- bezpośredni transfer danych Project Peer;
- integralność spakowanego Runtime Host/Guest i Launcher.

Zmiany protokołu/schematu są addytywne tylko przy zachowaniu semantyki. Dokładne numery określa `release-contract.json`. Nie mieszaj manifestów ani binariów Runtime/Launcher różnych kandydatów tylko dlatego, że mają tę samą widoczną wersję.

## Unity

Obsługiwana linia to **Unity 6000.3**. Poprawka Editor jest zwalidowana dopiero po zapisaniu dowodów dla danego źródła/kandydata. Najnowsza poprawka nie jest automatycznie testowana ani wspierana. Wybór testowanego Editor określa `release-contract.json`, a dowody podsumowuje [STATUS.md](STATUS.md).

## Programiści i runtime

Używaj zakresów Node/npm/.NET/narzędzi z kontraktu oraz konfiguracji lock/build repozytorium. To **wymagania źródeł/budowania**, nie standardowej instalacji spakowanego Host/Guest, korzystającej z dołączonych/samowystarczalnych runtime zgodnie z kontraktem. Nowa główna rodzina runtime/toolchain wymaga świadomej decyzji i walidacji; jedna udana instalacja nie wystarcza.

## Obsługiwana topologia

- WebSocket skonfigurowanego Server TeamForge jako autorytet czasu rzeczywistego;
- bezpośredni HTTP Project Peer na jednym PC, osiągalnym LAN lub zarządzanym VPN;
- jawny tryb jednego PC tylko przez loopback;
- uwierzytelnione nasłuchiwanie poza loopback z konkretnym hostem ogłoszonym Guest;
- spakowany Windows Host/Guest ze zweryfikowanym dołączonym Runtime.

Nie są obecnie dostarczane jako wspierane: WebRTC / RTCDataChannel; ICE / STUN / TURN; automatyczne przechodzenie NAT; relay/automatyczny transport zapasowy; wykrywanie peerów; autorytet czasu rzeczywistego serverless/wbudowany; wdrożenie w niezaufanym publicznym Internecie z pełnym systemem tożsamości i autoryzacji.

`P2P` oznacza **bezpośredni transfer danych Project Peer**, nie automatyczną łączność P2P przez Internet.

## Macierz platform

| Obszar | Stan |
| --- | --- |
| Runtime Windows x64 / Guest Launcher | Obecny kierunek pakietu; kandydat nadal podlega bramkom terenowym STATUS |
| Unity 6000.3 | Obecna linia Unity |
| Zapisana poprawka Unity | `release-contract.json` i dowody STATUS |
| Inne poprawki Unity 6000.3 | Osobna baseline/walidacja przed uznaniem za testowane |
| Samodzielny Launcher macOS/Linux | Brak równoważnego aktualnego pakietu |
| Docker/Compose | Opcja źródeł/serwera, nie zwykły spakowany Host ani bramka wydania |
| Authenticode | Stan dystrybucji/podpisu w STATUS/dokumentacji artefaktu |

## Zarządzany magazyn Windows w bieżącym kodzie

Bieżący kod wymaga lokalnego stałego korzenia NTFS/ReFS do blokowania tożsamości projektu Windows. Korzenie sieciowe, niedostępne lub niezweryfikowane są odrzucane (fail-closed). Dotyczy to magazynu TeamForge, nie wszystkich projektów Unity. Granicę kod/publikowany kandydat opisuje [STATUS.md](STATUS.md); zobacz [implementację](../project-peer/src/project-identity-lock.mjs).

## Deklaracje i historia

Historyczne raporty faz, prac i testów dotyczą zapisanych źródeł/artefaktów. Podobna wersja produktu nie czyni ich aktualnym dowodem. Dla tożsamości bajtów używaj nazwy zasobu Release + SHA-256, nie tylko wersji.
