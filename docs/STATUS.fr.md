# État actuel de TeamForge

[English](STATUS.md) · [Fonctionnement](HOW_IT_WORKS.fr.md)

_Cette traduction d’aperçu a été comparée au document canonique anglais `STATUS.md` du 2026-10-08. Pour les preuves détaillées, les Issues et les décisions actuelles, la version anglaise fait foi._

> **Aperçu public précoce : n’utilisez pas TeamForge comme unique copie ou unique mécanisme de récupération d’un Unity Project important.** Gardez des sauvegardes et privilégiez des Projects de test jetables.

## Résumé actuel

- Ligne produit : `0.5.1`
- Source lineage : `0.5.1-wp5.1-path-resilience`
- Dernier candidat publié : `v0.5.1-prealpha-wp5.1-r8`
- Source commit r7 : `4aff5756329c2fe013d78344859e0760c6a382ef`
- ZIP Windows : `Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r8-win-x64.zip`
- SHA-256 : `3a003791043c067009250bf59da4d916e75eb6dc1b1ed0e93d54984a2d23eb21`
- Cible : Windows x64
- État de préparation : **FIELD BLOCKED**
- Ligne Unity : `6000.3` (Editor de test enregistré : `6000.3.21f1`)
- Realtime / Project Transfer / Project Manifest : **v1**

## Publication r8 et limites des preuves

r8 a été publié le 2026-10-10 avec les correctifs du PR #209 concernant la santé du Direct Seed, l'ouverture vérifiée d'Existing-Active et le refus des racines de projet imbriquées. Le ZIP publié a réussi la Windows Exact Release Validation (exécution 38019297086), mais **aucun essai r8 sur deux PC Windows physiques n'a encore été effectué** ; l'état reste **FIELD BLOCKED**. Les résultats r7 ci-dessous sont historiques et ne prouvent pas les corrections r8 sur le terrain. Les PR #217 et #219 ont été fusionnées plus tard et ne figurent pas dans le ZIP r8.

## Limite des preuves r7

r7 a été publié le 2026-10-03 depuis le commit d88ca4c41ecf1f9cc7aa5d349960f407f158ce9a, puis a réussi la **Exact Release Validation** Windows. Le workflow a retéléchargé le ZIP du Release, vérifié son SHA-256 et tous les hashes du release manifest, effectué une extraction neuve dans un chemin contenant des caractères coréens et des espaces depuis un autre répertoire de travail, puis vérifié Runtime/Node empaqueté, le comportement fail-closed du Launcher, Windows path resilience et de vraies junctions.

Il s’agit de **preuves automatisées sur le paquet exact**. Lors d’un essai physique ultérieur avec Host r6 et Guest r7 exact, le Guest a réutilisé le managed root existant sans `destination_contains_unmanaged_content` ; après passage du profil LAN de confiance du Host de Public à Private, le flux a progressé via Publisher trust, Project receive et l’ouverture de Unity jusqu’à une connexion TeamForge signalée par l’utilisateur. Cela ne prouve pas encore r7 exact sur les deux PC, un onboarding UAC neuf sans élévation, le fallback du port Seed ni la récupération physique de Project identity après perte anormale du processus. L’état reste donc FIELD BLOCKED.

Les preuves physiques r5 du 2026-08-31 restent valides pour les scénarios réellement exécutés : reconnect, late join, receive/resume, long path, lock contention et Seed `5091`/transfert. La publication de r7 ne modifie ni les bytes r5 ni ces résultats historiques.

## Blocages r7-on-Host ultérieurs et correctifs non fusionnés

Les essais physiques ultérieurs ont révélé `baseline_unavailable` alors que le Host affichait Ready sans Direct Project Peer découvrable, une `DirectoryNotFoundException` liée aux chemins longs lors de l’ouverture d’un Project vérifié existant. La revue du Source a aussi identifié un risque d’UUID imbriqués lorsqu’un répertoire de Project est choisi comme Projects root.

Depuis le 2026-10-08, la PR #209 est fusionnée dans `main`. Les correctifs figurent désormais dans le code source, mais **pas** dans le ZIP r7 publié. La CI, les tests Unity et l’Engineering Quality Gate de la PR mise à jour ont réussi ; un nouveau candidat immuable avec validation exact-release et essais physiques reste nécessaire. Le PASS mixte r6/r7 antérieur garde uniquement sa portée initiale ; l’état reste **FIELD BLOCKED**.

[PR #209](https://github.com/Eun-si123/teamforge-unity-collab/pull/209) · [English evidence/status](https://eun-si123.github.io/teamforge-unity-collab/status/#later-r7-on-host-blockers-and-pending-source-fixes)

## Périmètre actuel

Presence, Selection, synchronisation Transform, lock/ownership de base, opérations Same-Scene Hierarchy prises en charge, Project transfer P2P direct, UX de diagnostic/récupération et Windows path resilience sont implémentés ou en stabilisation. r7 ajoute le Windows firewall onboarding post-r5, le fallback de Seed port occupé/indisponible, Windows Project identity crash recovery, des diagnostics supplémentaires et le feedback SceneView `TeamForge · Locked by <owner>`.

La synchronisation Component/Inspector générale, Prefab/Asset générique, la récupération persistante après redémarrage server/session et le NAT traversal/relay Internet automatique ne sont pas pris en charge actuellement.

## Validation terrain restante

1. Extraire **r7 exact** sur deux PC Windows propres et tester Firewall onboarding/UAC, les règles limitées à Private + `LocalSubnet` et leur lifecycle.
2. Forcer l’indisponibilité/le conflit du Seed port préféré ; vérifier que l’endpoint réellement annoncé après fallback est joignable, puis Host Stop/Start et Fresh Guest transfer.
3. Simuler une perte anormale de processus pendant Project identity et confirmer une recovery sûre, avec fail closed maintenu pour les identités ambiguës/conflictuelles.
4. Exécuter Fresh Host → Fresh Guest → Unity realtime smoke ; vérifier que le feedback foreign-lock est compréhensible et disparaît après release/takeover.
5. Garder #182 comme surveillance CI intermittente sans la masquer par retry/skip ; #79 reste le suivi UX du mouvement SceneView transitoire.

## Sources de référence

Détails capacités/blockers/preuves : [English STATUS](STATUS.md) ; sélections exactes : [`release-contract.json`](../release-contract.json) ; identité des bytes publiés : [`builds/README.md`](../builds/README.md) et SHA-256 du GitHub Release.
