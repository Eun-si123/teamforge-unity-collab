# État actuel de TeamForge

[English](STATUS.md) · [Fonctionnement](HOW_IT_WORKS.fr.md)

_Cette traduction d’aperçu a été comparée au document canonique anglais `STATUS.md` du 2026-10-04. Pour les preuves détaillées, les Issues et les décisions actuelles, la version anglaise fait foi._

> **Aperçu public précoce : n’utilisez pas TeamForge comme unique copie ou unique mécanisme de récupération d’un Unity Project important.** Gardez des sauvegardes et privilégiez des Projects de test jetables.

## Résumé actuel

- Ligne produit : `0.5.1`
- Source lineage : `0.5.1-wp5.1-path-resilience`
- Dernier candidat publié : `v0.5.1-prealpha-wp5.1-r7`
- Source commit r7 : `d88ca4c41ecf1f9cc7aa5d349960f407f158ce9a`
- ZIP Windows : `Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r7-win-x64.zip`
- SHA-256 : `a710acd3cd7189c3f44ae1b4ee46a15239313c850ad7f6982e3a58f2492a13aa`
- Cible : Windows x64
- État de préparation : **FIELD BLOCKED**
- Ligne Unity : `6000.3` (Editor de test enregistré : `6000.3.21f1`)
- Realtime / Project Transfer / Project Manifest : **v1**

## Limite des preuves r7

r7 a été publié le 2026-10-03 depuis le commit ci-dessus, puis a réussi la **Exact Release Validation** Windows. Le workflow a retéléchargé le ZIP du Release, vérifié son SHA-256 et tous les hashes du release manifest, effectué une extraction neuve dans un chemin contenant des caractères coréens et des espaces depuis un autre répertoire de travail, puis vérifié Runtime/Node empaqueté, le comportement fail-closed du Launcher, Windows path resilience et de vraies junctions.

Il s’agit de **preuves automatisées sur le paquet exact**. Elles ne prouvent pas encore Firewall/UAC sur deux PC physiques, la joignabilité LAN réelle, la récupération de Project identity après perte anormale du processus ni le flux complet Host → Guest → realtime. L’état reste donc FIELD BLOCKED.

Les preuves physiques r5 du 2026-08-31 restent valides pour les scénarios réellement exécutés : reconnect, late join, receive/resume, long path, lock contention et Seed `5091`/transfert. La publication de r7 ne modifie ni les bytes r5 ni ces résultats historiques.

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
