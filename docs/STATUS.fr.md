# État actuel de TeamForge

[English](STATUS.md) · [Fonctionnement](HOW_IT_WORKS.fr.md)

_Cette traduction d’aperçu a été comparée au document canonique anglais `STATUS.md` du 2026-11-11. Pour les preuves détaillées, les Issues et les décisions actuelles, la version anglaise fait foi._

> **Aperçu public précoce : n’utilisez pas TeamForge comme unique copie ou unique mécanisme de récupération d’un Unity Project important.** Gardez des sauvegardes et privilégiez des Projects de test jetables.

> **2026-10-20 r9 field evidence:** Published r9 passed exact-release validation; user-reported two-PC basic collaboration and Guest reconnect PASS. Full recovery/negative field gate remains BLOCKED. [Current detail](https://github.com/Eun-si123/teamforge-unity-collab/blob/main/docs/STATUS.md).
> **2026-11-04 r10 user-reported two-PC field signal (not a package certification):** Basic Host/Guest collaboration, receive/reconnect, access-code rejection and one long destination were reported PASS; separate installed ZIP hashes were **not** checked on both machines. The published r10 ZIP passed [automated Exact Release Validation #41630492102](https://github.com/Eun-si123/teamforge-unity-collab/actions/runs/41630492102), but an actual Guest Wi-Fi/NIC outage was **NOT RUN** ([#457](https://github.com/Eun-si123/teamforge-unity-collab/issues/457)) and repeated Launcher startup exposed a defect (fixed in later source [#456](https://github.com/Eun-si123/teamforge-unity-collab/pull/456), **not** in r10). Full field readiness is **FIELD BLOCKED**. [Dated evidence](PHYSICAL_FIELD_EVIDENCE_2026-11-04_R10.md).

## Résumé actuel

- Ligne produit : `0.5.1`
- Source lineage : `0.5.1-wp5.1-path-resilience`
- Dernier candidat publié : `v0.5.1-prealpha-wp5.1-r10`
- Source commit r10 : `693d3a9d647f9a511012f1ebba3209834531656e`
- ZIP Windows : `Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r10-win-x64.zip`
- SHA-256 : `01afb269bd6235470bd75d1dda6a6c0119d0e21acea87087fe1115d0cd002f89`
- Cible : Windows x64
- État de préparation : **FIELD BLOCKED**
- Ligne Unity : `6000.3` (Editor de test enregistré : `6000.3.21f1`)
- Realtime / Project Transfer / Project Manifest : **v1**

## Intégration M1 dans les sources : édition partagée de Collider

M1 nécessite une activation explicite dans les sources et ne figure pas dans le ZIP r10 publié. Les propriétés trigger, center et size/radius de BoxCollider/SphereCollider dans une Scene enregistrée sans Prefab suivent le chemin réel : vérification des octets Scene/meta signés → Server Authority → WebSocket → Unity Editor. Après l’admission initiale, les modifications continues sans enregistrement utilisent le ledger serveur, les revision/history communes et le verrou GameObject. La fenêtre Collider Collaboration propose un Undo/Redo conditionnel des changements propres et une boîte de récupération permettant d’examiner puis de renvoyer explicitement les valeurs locales non confirmées. Commit serveur, rapport d’application Editor et sauvegarde disque sont des états distincts.

Les preuves comportent quatre étapes. **Implémentation** : le chemin source existe ; revue finale et contrôles PR restent nécessaires. **Validation automatique** : les tests réels Node WebSocket de réussite, conflit, doublon, late join et reconnexion, ainsi que les tests de source signée, passent ; le PR consigne le SHA final. **Intégration Unity** : **NOT RUN** localement, faute de Unity Editor ; un résultat CI en attente avec un véritable Editor et un peer Node ne vaut pas PASS. **Paquet et Windows physique** : M1 **NOT RUN**, sans nouvelle publication ni promotion ; les preuves historiques r10 et FIELD BLOCKED sont conservées.

Limites : une Scene par Session, 128 Sessions conservées en mémoire, 512 Colliders/1536 propriétés et valeurs finies ±100/0–100. Les champs non pris en charge restent locaux. Ajouter/supprimer des Components, les Prefabs et supprimer le propriétaire d’un Collider admis ou ses ancêtres nécessitent M2 et sont refusés dans ce chemin M1 actif. Les éditeurs doivent négocier et rejoindre la capacité compatible. Le ledger reste en mémoire après la déconnexion de tous les peers, mais **un redémarrage serveur le perd** ; la récupération durable relève de M4. Deux Unity Editors, late join à trois, sauvegarde/réouverture, huit Editors pendant une heure et l’artefact Windows exact restent des validations séparées. La suite est M2, cycle de vie des Components. Voir le [STATUS anglais](STATUS.md) et la [configuration](../server/README.md).

## Publication r8 et limites des preuves

r8 a été publié le 2026-10-10 avec les correctifs du PR #209 concernant la santé du Direct Seed, l'ouverture vérifiée d'Existing-Active et le refus des racines de projet imbriquées. Le ZIP publié a réussi la Windows Exact Release Validation (exécution 38019297086), mais **aucun essai r8 sur deux PC Windows physiques n'a encore été effectué** ; l'état reste **FIELD BLOCKED**. Les résultats r7 ci-dessous sont historiques et ne prouvent pas les corrections r8 sur le terrain. Les PR #217 et #219 ont été fusionnées plus tard et ne figurent pas dans le ZIP r8.

## Limite des preuves r7

r7 a été publié le 2026-10-03 depuis le commit d88ca4c41ecf1f9cc7aa5d349960f407f158ce9a, puis a réussi la **Exact Release Validation** Windows. Le workflow a retéléchargé le ZIP du Release, vérifié son SHA-256 et tous les hashes du release manifest, effectué une extraction neuve dans un chemin contenant des caractères coréens et des espaces depuis un autre répertoire de travail, puis vérifié Runtime/Node empaqueté, le comportement fail-closed du Launcher, Windows path resilience et de vraies junctions.

Il s’agit de **preuves automatisées sur le paquet exact**. Lors d’un essai physique ultérieur avec Host r6 et Guest r7 exact, le Guest a réutilisé le managed root existant sans `destination_contains_unmanaged_content` ; après passage du profil LAN de confiance du Host de Public à Private, le flux a progressé via Publisher trust, Project receive et l’ouverture de Unity jusqu’à une connexion TeamForge signalée par l’utilisateur. Cela ne prouve pas encore r7 exact sur les deux PC, un onboarding UAC neuf sans élévation, le fallback du port Seed ni la récupération physique de Project identity après perte anormale du processus. L’état reste donc FIELD BLOCKED.

Les preuves physiques r5 du 2026-08-31 restent valides pour les scénarios réellement exécutés : reconnect, late join, receive/resume, long path, lock contention et Seed `5091`/transfert. La publication de r7 ne modifie ni les bytes r5 ni ces résultats historiques.

## Blocages r7-on-Host ultérieurs et nouveaux essais avec r8

Les essais physiques ultérieurs ont révélé `baseline_unavailable` alors que le Host affichait Ready sans Direct Project Peer découvrable, une `DirectoryNotFoundException` liée aux chemins longs lors de l’ouverture d’un Project vérifié existant. La revue du Source a aussi identifié un risque d’UUID imbriqués lorsqu’un répertoire de Project est choisi comme Projects root.

La PR #209 a été fusionnée dans `main` le 2026-10-08 ; ses correctifs sont **inclus dans le ZIP r8 publié**. r8 a réussi Windows Exact Release Validation (exécution 38019297086), mais les essais sur deux PC Windows physiques restent à faire : retirer Ready en cas de perte du Direct Seed, rouvrir Existing-Active via le chemin court et refuser un dossier Project UUID comme Projects root. La cause initiale de la disparition du Seed reste inconnue. Le PASS mixte r6/r7 antérieur garde sa portée initiale ; l’état reste **FIELD BLOCKED**.

[PR #209](https://github.com/Eun-si123/teamforge-unity-collab/pull/209) · [English evidence/status](https://eun-si123.github.io/teamforge-unity-collab/status/#later-r7-on-host-blockers-now-packaged-for-r8-retest)

## Périmètre actuel

Presence, Selection, synchronisation Transform, lock/ownership de base, opérations Same-Scene Hierarchy prises en charge, Project transfer P2P direct, UX de diagnostic/récupération et Windows path resilience sont implémentés ou en stabilisation. r7 ajoute le Windows firewall onboarding post-r5, le fallback de Seed port occupé/indisponible, Windows Project identity crash recovery, des diagnostics supplémentaires et le feedback SceneView `TeamForge · Locked by <owner>`.

La synchronisation Component/Inspector générale, Prefab/Asset générique, la récupération persistante après redémarrage server/session et le NAT traversal/relay Internet automatique ne sont pas pris en charge actuellement.

## Validation terrain restante

1. Extraire **r10 exact** sur deux PC Windows propres et tester Firewall onboarding/UAC, les règles limitées à Private + `LocalSubnet` et leur lifecycle.
2. Forcer l’indisponibilité/le conflit du Seed port préféré ; vérifier que l’endpoint réellement annoncé après fallback est joignable, puis Host Stop/Start et Fresh Guest transfer.
3. Simuler une perte anormale de processus pendant Project identity et confirmer une recovery sûre, avec fail closed maintenu pour les identités ambiguës/conflictuelles.
4. Exécuter Fresh Host → Fresh Guest → Unity realtime smoke ; vérifier que le feedback foreign-lock est compréhensible et disparaît après release/takeover.
5. Garder #182 comme surveillance CI intermittente sans la masquer par retry/skip ; #79 reste le suivi UX du mouvement SceneView transitoire.

## Sources de référence

Détails capacités/blockers/preuves : [English STATUS](STATUS.md) ; sélections exactes : [`release-contract.json`](../release-contract.json) ; identité des bytes publiés : [`builds/README.md`](../builds/README.md) et SHA-256 du GitHub Release.
