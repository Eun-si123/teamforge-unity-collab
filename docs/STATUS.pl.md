# Aktualny stan TeamForge

[English](STATUS.md) · [Jak to działa](HOW_IT_WORKS.pl.md)

_To tłumaczenie podglądowe porównano z kanonicznym angielskim `STATUS.md` z 2026-10-07. W sprawie szczegółowych dowodów, Issues i bieżących decyzji źródłem prawdy pozostaje wersja angielska._

> **Wczesny publiczny podgląd: nie używaj TeamForge jako jedynej kopii ani jedynego sposobu odzyskania ważnego Unity Project.** Zachowuj backupy i najlepiej testuj na Projectach, które można usunąć.

## Aktualne podsumowanie

- Linia produktu: `0.5.1`
- Source lineage: `0.5.1-wp5.1-path-resilience`
- Najnowszy opublikowany kandydat: `v0.5.1-prealpha-wp5.1-r7`
- Source commit r7: `d88ca4c41ecf1f9cc7aa5d349960f407f158ce9a`
- Windows ZIP: `Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r7-win-x64.zip`
- SHA-256: `a710acd3cd7189c3f44ae1b4ee46a15239313c850ad7f6982e3a58f2492a13aa`
- Target: Windows x64
- Gotowość wydania: **FIELD BLOCKED**
- Linia Unity: `6000.3` (zapisany test Editor: `6000.3.21f1`)
- Realtime / Project Transfer / Project Manifest: **v1**

## Granica dowodów r7

r7 opublikowano 2026-10-03 z powyższego commitu, a następnie przeszedł Windows **Exact Release Validation**. Automatyzacja ponownie pobrała ZIP Release, sprawdziła SHA-256 i każdy hash z release manifest, wykonała świeże rozpakowanie do ścieżki z koreańskimi znakami i spacjami z innego katalogu roboczego oraz zweryfikowała spakowany Runtime/Node, zachowanie fail-closed Launchera, Windows path resilience i prawdziwe junctions.

To jest **automatyczny dowód dla dokładnie tego pakietu**. W późniejszym teście fizycznym z Hostem r6 i dokładnym Guestem r7 istniejący managed root został ponownie użyty bez `destination_contains_unmanaged_content`; po zmianie zaufanego profilu LAN Hosta z Public na Private przepływ przeszedł przez Publisher trust, Project receive i uruchomienie Unity aż do zgłoszonego połączenia TeamForge. Nadal nie dowodzi to exact r7 na obu PC, świeżego UAC bez podniesionych uprawnień, fallbacku portu Seed ani fizycznego Project identity recovery po nietypowej utracie procesu. Dlatego stan pozostaje FIELD BLOCKED.

Fizyczne dowody r5 z 2026-08-31 pozostają ważne dla faktycznie wykonanych wtedy scenariuszy: reconnect, late join, receive/resume, long path, lock contention oraz Seed `5091`/transfer. Publikacja r7 nie zmienia bajtów ani historycznych wyników r5.

## Późniejsze blokery r7-on-Host i niewłączone poprawki

Późniejsze testy fizyczne ujawniły `baseline_unavailable`, gdy Host nadal pokazywał Ready bez dostępnego Direct Project Peer, błąd długiej ścieżki `DirectoryNotFoundException` przy otwieraniu istniejącego zweryfikowanego Project. Przegląd Source wykazał też ryzyko zagnieżdżonych UUID po wybraniu katalogu pojedynczego Project jako Projects root.

Na dzień 2026-10-07 PR #209 nie został scalony. Poprawek nie ma w obecnym Runtime `main` ani w opublikowanym ZIP r7. Ich weryfikacja wymaga nowego niezmiennego kandydata oraz walidacji exact-release/fizycznej. Wcześniejszy mieszany PASS r6/r7 zachowuje swój zakres; stan pozostaje FIELD BLOCKED.

[PR #209](https://github.com/Eun-si123/teamforge-unity-collab/pull/209) · [English evidence/status](https://eun-si123.github.io/teamforge-unity-collab/status/#later-r7-on-host-blockers-and-pending-source-fixes)

## Aktualny zakres funkcji

Presence, Selection, synchronizacja Transform, podstawowe lock/ownership, wspierane operacje Same-Scene Hierarchy, bezpośredni P2P Project transfer, UX diagnostyki/odzyskiwania i Windows path resilience są zaimplementowane lub stabilizowane. r7 zawiera również Windows firewall onboarding po r5, fallback przy zajętym/niedostępnym Seed port, Windows Project identity crash recovery, dodatkową diagnostykę i komunikat SceneView `TeamForge · Locked by <owner>`.

Ogólna synchronizacja Component/Inspector, Prefab/ogólne Asset collaboration, trwałe server/session restart recovery oraz automatyczny Internet NAT traversal/relay nie są obecnie wspierane.

## Pozostała walidacja fizyczna

1. Świeżo rozpakować **dokładne r7** na dwóch Windows PC i sprawdzić Firewall onboarding/UAC, wąskie reguły Private + `LocalSubnet` oraz ich lifecycle.
2. Wymusić konflikt/niedostępność preferowanego Seed port; sprawdzić rzeczywistą osiągalność endpointu ogłoszonego po fallback, a także Host Stop/Start i Fresh Guest transfer.
3. Zasymulować nietypową utratę procesu podczas Project identity i potwierdzić bezpieczne recovery oraz dalsze fail closed dla niejednoznacznych/sprzecznych identity.
4. Wykonać Fresh Host → Fresh Guest → Unity realtime smoke oraz sprawdzić czy foreign-lock feedback jest jasny i znika po release/takeover.
5. #182 pozostaje obserwacją sporadycznego CI bez maskowania retry/skip; #79 pozostaje UX follow-up dla przejściowego ruchu SceneView.

## Źródła odniesienia

Szczegóły możliwości, blockerów i dowodów: [English STATUS](STATUS.md); dokładne wybory: [`release-contract.json`](../release-contract.json); tożsamość opublikowanych bajtów: [`builds/README.md`](../builds/README.md) i SHA-256 GitHub Release.
