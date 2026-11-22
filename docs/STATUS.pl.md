# Aktualny stan TeamForge

> **r11 release update (2026-11-21):** [r11 Windows test ZIP](https://github.com/Eun-si123/teamforge-unity-collab/releases/tag/v0.5.1-prealpha-wp5.1-r11) passed exact ZIP validation, but new M1–M4 functions have NOT passed two-physical-PC Windows tests; **FIELD BLOCKED** remains. The text below is a dated translation snapshot; refer to the [current English STATUS](STATUS.md) for up-to-date claims.

[English](STATUS.md) · [Jak to działa](HOW_IT_WORKS.pl.md)

_To tłumaczenie podglądowe porównano z kanonicznym angielskim `STATUS.md` z 2026-11-20. W sprawie szczegółowych dowodów, Issues i bieżących decyzji źródłem prawdy pozostaje wersja angielska._

**Aktualizacja źródła 2026-11-20:** M4 (#572) wprowadza opcjonalne odzyskiwanie Session przez SQLite. Testy r9/r10 na dwóch prawdziwych PC z Windows dla podstawowej współpracy i ponownego połączenia już wykonano i zgłoszono PASS; nie obejmowały M4. Wydany pakiet r10 pozostaje bez zmian, stan **FIELD BLOCKED**.


> **Wczesny publiczny podgląd: nie używaj TeamForge jako jedynej kopii ani jedynego sposobu odzyskania ważnego Unity Project.** Zachowuj backupy i najlepiej testuj na Projectach, które można usunąć.

> **2026-10-20 r9 field evidence:** Published r9 passed exact-release validation; user-reported two-PC basic collaboration and Guest reconnect PASS. Full recovery/negative field gate remains BLOCKED. [Current detail](https://github.com/Eun-si123/teamforge-unity-collab/blob/main/docs/STATUS.md).
> **2026-11-04 r10 user-reported two-PC field signal (not a package certification):** Basic Host/Guest collaboration, receive/reconnect, access-code rejection and one long destination were reported PASS; separate installed ZIP hashes were **not** checked on both machines. The published r10 ZIP passed [automated Exact Release Validation #41630492102](https://github.com/Eun-si123/teamforge-unity-collab/actions/runs/41630492102), but an actual Guest Wi-Fi/NIC outage was **NOT RUN** ([#457](https://github.com/Eun-si123/teamforge-unity-collab/issues/457)) and repeated Launcher startup exposed a defect (fixed in later source [#456](https://github.com/Eun-si123/teamforge-unity-collab/pull/456), **not** in r10). Full field readiness is **FIELD BLOCKED**. [Dated evidence](PHYSICAL_FIELD_EVIDENCE_2026-11-04_R10.md).

## Aktualne podsumowanie

- Linia produktu: `0.5.1`
- Source lineage: `0.5.1-wp5.1-path-resilience`
- Najnowszy opublikowany kandydat: `v0.5.1-prealpha-wp5.1-r11`
- Source commit r11: `5868efe02975aa94b2acd79f5dec39a7b830aa26`
- Windows ZIP: `Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r11-win-x64.zip`
- SHA-256: `28774bccb9fb20da0d72fce38d9bab7645dac1b876de182fbd33ee421170a989`
- Target: Windows x64
- Gotowość wydania: **FIELD BLOCKED**
- Linia Unity: `6000.3` (zapisany test Editor: `6000.3.21f1`)
- Realtime / Project Transfer / Project Manifest: **v1**

## Integracja M1 w kodzie źródłowym: wspólna edycja Collider

M1 wymaga jawnego włączenia w źródłach i nie znajduje się w opublikowanym ZIP r10. Udostępnia trigger, center oraz size/radius komponentów BoxCollider/SphereCollider w zapisanej Scene bez Prefab przez rzeczywistą ścieżkę: weryfikacja podpisanych bajtów Scene/meta → Server Authority → WebSocket → Unity Editor. Po pierwszym przyjęciu ciągłe zmiany bez zapisu korzystają z ledger serwera, wspólnych revision/history i blokady GameObject. Okno Collider Collaboration udostępnia warunkowe Undo/Redo własnych zmian oraz skrzynkę odzyskiwania do przeglądania i jawnego ponownego wysyłania niepotwierdzonych wartości lokalnych. Commit serwera, raport zastosowania w Editor i zapis na dysku to oddzielne stany.

Dowody obejmują cztery etapy. **Implementacja**: M1 scalono z main przez [PR #533](https://github.com/Eun-si123/teamforge-unity-collab/pull/533). **Walidacja automatyczna**: rzeczywiste testy Node WebSocket przeszły. **Integracja Unity**: [CI dla dokładnego stanu źródeł](https://github.com/Eun-si123/teamforge-unity-collab/actions/runs/43329700733) zaliczyło edycję Collider, warunkowe Undo i ponowne połączenie z jednym prawdziwym Edytorem i peerem Node w trzech wersjach Unity; lokalne uruchomienie Unity na Linuksie pozostaje NOT RUN. **Pakiet i fizyczne Windows**: testy dwóch fizycznych Editorów oraz nowej paczki pozostają **NOT RUN**. Opublikowany ZIP r10 pozostaje bez zmian, stan **FIELD BLOCKED**. Dodawanie/usuwanie M2 [#559](https://github.com/Eun-si123/teamforge-unity-collab/pull/559) oraz poprawkę późnego dołączania [#565](https://github.com/Eun-si123/teamforge-unity-collab/pull/565) scalono z main 2026-11-18 jako domyślnie wyłączoną funkcję źródłową. CI z jednym rzeczywistym Edytorem i peerem Node przeszło na trzech wersjach Unity; dwa fizyczne Editory i nowy pakiet pozostają **NOT RUN**. Opublikowane r10 nie zawiera M1/M2. 2026-11-19 M3 dodawania/usuwania wspólnych wbudowanych Cube/Sphere scalono z main przez PR #569 jako opcjonalną funkcję źródłową. CI z rzeczywistym Edytorem i peerem Node przeszło na trzech wersjach Unity (40 kontroli PR). Dwa fizyczne Editory i nowy pakiet: NOT RUN; wydane r10 nie zawiera M3, stan FIELD BLOCKED.

Limity: jedna Scene na Session, 128 Session przechowywanych w pamięci, 512 Collider/1536 właściwości i skończone wartości ±100/0–100. Nieobsługiwane pola pozostają lokalne. Dodawanie/usuwanie Component, Prefab oraz usunięcie właściciela przyjętego Collider lub jego przodków wymagają M2 i są odrzucane w aktywnej ścieżce M1. Edytujący muszą wynegocjować zgodną funkcję i do niej dołączyć. Ledger pozostaje w pamięci po rozłączeniu wszystkich peerów, ale **restart serwera usuwa go bez włączonego M4**. Opcjonalny M4, już scalony ze źródłem, zapisuje potwierdzony stan Session w SQLite. Dwa Unity Editors, late join trzech osób, zapis/ponowne otwarcie, osiem Editors przez godzinę i dokładny artefakt Windows wymagają osobnych sprawdzeń. M2/M3/M4 są już scalone ze źródłem; testy fizyczne nowych funkcji są odrębne. Zobacz [angielski STATUS](STATUS.md) i [konfigurację](../server/README.md).

## Wydanie r8 i zakres dowodów

r8 opublikowano 2026-10-10; zawiera poprawki PR #209 dotyczące stanu Direct Seed, bezpiecznego otwierania zweryfikowanego Existing-Active oraz odrzucania zagnieżdżonych katalogów projektu. Opublikowany ZIP przeszedł Windows Exact Release Validation (uruchomienie 38019297086), lecz **r8 nie został jeszcze sprawdzony na dwóch fizycznych komputerach z Windows**; stan nadal to **FIELD BLOCKED**. Poniższe wyniki r7 są historyczne i nie dowodzą poprawności r8 w terenie. PR #217 i #219 połączono później, więc nie ma ich w ZIP r8.

## Granica dowodów r7

r7 opublikowano 2026-10-03 z commitu d88ca4c41ecf1f9cc7aa5d349960f407f158ce9a, a następnie przeszedł Windows **Exact Release Validation**. Automatyzacja ponownie pobrała ZIP Release, sprawdziła SHA-256 i każdy hash z release manifest, wykonała świeże rozpakowanie do ścieżki z koreańskimi znakami i spacjami z innego katalogu roboczego oraz zweryfikowała spakowany Runtime/Node, zachowanie fail-closed Launchera, Windows path resilience i prawdziwe junctions.

To jest **automatyczny dowód dla dokładnie tego pakietu**. W późniejszym teście fizycznym z Hostem r6 i dokładnym Guestem r7 istniejący managed root został ponownie użyty bez `destination_contains_unmanaged_content`; po zmianie zaufanego profilu LAN Hosta z Public na Private przepływ przeszedł przez Publisher trust, Project receive i uruchomienie Unity aż do zgłoszonego połączenia TeamForge. Nadal nie dowodzi to exact r7 na obu PC, świeżego UAC bez podniesionych uprawnień, fallbacku portu Seed ani fizycznego Project identity recovery po nietypowej utracie procesu. Dlatego stan pozostaje FIELD BLOCKED.

Fizyczne dowody r5 z 2026-08-31 pozostają ważne dla faktycznie wykonanych wtedy scenariuszy: reconnect, late join, receive/resume, long path, lock contention oraz Seed `5091`/transfer. Publikacja r7 nie zmienia bajtów ani historycznych wyników r5.

## Późniejsze blokery r7-on-Host i ponowne testy r8

Późniejsze testy fizyczne ujawniły `baseline_unavailable`, gdy Host nadal pokazywał Ready bez dostępnego Direct Project Peer, błąd długiej ścieżki `DirectoryNotFoundException` przy otwieraniu istniejącego zweryfikowanego Project. Przegląd Source wykazał też ryzyko zagnieżdżonych UUID po wybraniu katalogu pojedynczego Project jako Projects root.

PR #209 scalono z `main` dnia 2026-10-08; poprawki są **zawarte w opublikowanym ZIP r8**. r8 przeszedł Windows Exact Release Validation (uruchomienie 38019297086), ale nadal wymaga testów na dwóch fizycznych komputerach Windows: cofnięcia Ready po utracie Direct Seed, ponownego otwarcia Existing-Active przez krótką ścieżkę oraz odrzucenia katalogu Project UUID jako Projects root. Pierwotna przyczyna utraty Seed pozostaje niepotwierdzona. Wcześniejszy mieszany PASS r6/r7 zachowuje tylko swój pierwotny zakres; stan pozostaje **FIELD BLOCKED**.

[PR #209](https://github.com/Eun-si123/teamforge-unity-collab/pull/209) · [English evidence/status](https://eun-si123.github.io/teamforge-unity-collab/status/#later-r7-on-host-blockers-now-packaged-for-r8-retest)

## Aktualny zakres funkcji

Presence, Selection, synchronizacja Transform, podstawowe lock/ownership, wspierane operacje Same-Scene Hierarchy, bezpośredni P2P Project transfer, UX diagnostyki/odzyskiwania i Windows path resilience są zaimplementowane lub stabilizowane. r7 zawiera również Windows firewall onboarding po r5, fallback przy zajętym/niedostępnym Seed port, Windows Project identity crash recovery, dodatkową diagnostykę i komunikat SceneView `TeamForge · Locked by <owner>`.

Ogólna synchronizacja Component/Inspector, Prefab/ogólne Asset collaboration oraz automatyczny Internet NAT traversal/relay nadal nie są wspierane. Opcjonalny M4 do trwałego przechowywania Session jest w źródle, ale nie został sprawdzony na dwóch fizycznych Editorach ani w nowym pakiecie.

## Pozostała walidacja fizyczna

1. Świeżo rozpakować **dokładne r11** na dwóch Windows PC i sprawdzić Firewall onboarding/UAC, wąskie reguły Private + `LocalSubnet` oraz ich lifecycle.
2. Wymusić konflikt/niedostępność preferowanego Seed port; sprawdzić rzeczywistą osiągalność endpointu ogłoszonego po fallback, a także Host Stop/Start i Fresh Guest transfer.
3. Zasymulować nietypową utratę procesu podczas Project identity i potwierdzić bezpieczne recovery oraz dalsze fail closed dla niejednoznacznych/sprzecznych identity.
4. Wykonać Fresh Host → Fresh Guest → Unity realtime smoke oraz sprawdzić czy foreign-lock feedback jest jasny i znika po release/takeover.
5. #182 pozostaje obserwacją sporadycznego CI bez maskowania retry/skip; #79 pozostaje UX follow-up dla przejściowego ruchu SceneView.

## Źródła odniesienia

Szczegóły możliwości, blockerów i dowodów: [English STATUS](STATUS.md); dokładne wybory: [`release-contract.json`](../release-contract.json); tożsamość opublikowanych bajtów: [`builds/README.md`](../builds/README.md) i SHA-256 GitHub Release.
