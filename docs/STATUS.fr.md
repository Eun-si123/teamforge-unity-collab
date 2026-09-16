# État actuel de TeamForge

[English](STATUS.md) · [Fonctionnement](HOW_IT_WORKS.fr.md)

_Revue documentaire de l’original : 2026-09-10 UTC. Rapprochement du code main après r5 (réseau Windows, diagnostics, identité de projet), de l’artefact r5 publié et des résultats physiques de ce r5 exact du 2026-08-31. Les preuves du paquet et celles du code ultérieur restent distinctes._

> **Aperçu public initial : ne faites pas de TeamForge l’unique copie ou moyen de récupération d’un projet Unity important.** Les blocages Windows WP5.1 initiaux ont reçu une validation physique substantielle sur r5 exact. main est plus récent et contient des changements réseau/identité qui n’ont pas encore été validés ensemble dans un paquet de remplacement exact sur des PC physiques. Gardez des sauvegardes et privilégiez les projets jetables.

[STATUS anglais](STATUS.md) est la référence humaine pour les capacités et la préparation à la publication. Les autres documents doivent y renvoyer plutôt que maintenir un état concurrent des blocages. Choix exacts : [release-contract.json](../release-contract.json) ; identité des octets et paquets remplacés : [builds/README.md](../builds/README.md) ; détails des bugs et reproductions historiques : Issues GitHub.

## Vue d’ensemble

- Ligne produit : `0.5.1` ; lignée du code : `0.5.1-wp5.1-path-resilience`.
- Dernier candidat empaqueté publié : `v0.5.1-prealpha-wp5.1-r5`.
- Commit source/tag r5 : `a97b6ba5649e2888b909bf3c99c64acfd7042ba6`.
- ZIP : `Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r5-win-x64.zip`.
- SHA-256 : `5944abf2263502ee40f49d0ac2c8a9826a809dc4cd1b20c9edf82f94ba35f8cc`.
- Cible empaquetée : Windows x64 ; état : **FIELD BLOCKED**, conditions terrain non remplies.
- Unity : `6000.3` ; Editor de test enregistré : `6000.3.21f1`.
- Realtime Protocol, Project Transfer Protocol et Project Manifest Schema : **v1** chacun.

## Code et candidat publié

Les correctifs WP5.1 initiaux de #67, #68/#74, #69, #70 et #71 ont été intégrés via PR #81. r5 vient du commit indiqué et comprend ces correctifs ainsi que l’intégration Launcher **Save support bundle** postérieure à r4.

Le 2026-08-31, r5 exact a été testé sur deux PC Windows physiques : reconnexion d’un Guest sauvegardé, snapshot Transform d’un nouveau participant tardif, arrêts/reprises répétés pendant réception, transfert à Unity par execution alias pour chemins longs/profonds, récupération de conflit protégé lié à une ancienne contention de verrou. Après autorisation du pare-feu, Stop/Start du Host a repris l’écoute Seed TCP `5091` et un vrai transfert Guest a réussi.

Ces scénarios n’attendent donc plus leur premier nouvel essai physique r5. Cela n’intègre pas les changements ultérieurs à r5 et ne fait pas du produit une alpha généralement installable. Les affirmations sur le paquet concernent r5 et ses preuves du 2026-08-31, sans équivalence d’octets ni de comportement avec main. Ne rouvrez pas artificiellement les scénarios clos à cause d’anciens textes. Distribuer main exige un nouvel artefact immuable et la validation des comportements ajoutés depuis r5 sur cet artefact précis.

## Renforcements absents de r5

- Configuration LAN du pare-feu Windows : après accord explicite utilisateur/UAC, création possible de règles entrantes Coordinator/Seed limitées au profil Private et à LocalSubnet, avec rapprochement/nettoyage des règles appartenant à TeamForge. r5 exigeait une autorisation manuelle ; ce nouveau parcours attend des preuves physiques du paquet exact.
- Port Seed préféré/par défaut occupé ou indisponible, y compris `EACCES` dans le contexte de bind Windows : Host réessaie une fois avec un port attribué par l’OS et annonce l’endpoint retenu. Couverture automatique Windows Project Peer disponible, mais comportement post-r5.
- Sérialisation de création d’identité de projet et récupération après plantage Windows par verrou vivant named-pipe détenu par l’OS et barrière permanente de compatibilité pour anciens writers. Suites Windows Node 22/24 plantage/concurrence réussies ; aucun paquet publié avec ce changement n’a de preuve physique exacte.
- Nettoyage après refus Coordinator, annulation/échéances HTTP, contexte diagnostic Host, journaux de rôle client WebSocket, distinction invitations Launcher/codes `TF1`.

Ce sont des faits de code/automatisation, pas du paquet r5. La récupération des verrous d’identité périmés Linux/macOS reste hors du changement Windows.

## Capacités

| Domaine | État source | Limite des preuves |
| --- | --- | --- |
| Présence des utilisateurs | Implémentée/exercée | Base physique deux PC réussie ; tests externes plus larges utiles |
| Sélection/contexte Editor | Implémentés/exercés | Tests externes plus larges utiles |
| Transform | Implémenté/en stabilisation | r5 arrivée tardive et récupération de contention PASS ; couverture terrain/UX à poursuivre |
| Verrouillage/propriété | Implémentés/en stabilisation | r5 contention/récupération PASS ; UX avec verrou d’autrui suivie par #79 |
| Hierarchy même Scene : créer/supprimer/renommer/reparenter/ordonner | Implémentée/en stabilisation | Sous-ensemble exercé physiquement ; couverture plus large utile |
| Initialisation/Collaboration Invite | Implémentées/en stabilisation | Guest sauvegardé r5 PASS ; récupération d’identité ultérieure sans preuve paquet/terrain |
| P2P direct | Implémenté/en stabilisation | r5 `5091` Stop/Start et transfert PASS ; nouveaux pare-feu/fallback sans preuve du remplacement |
| Diagnostics/UX de récupération | Implémentés/en stabilisation | r5 inclut le support bundle respectueux de la vie privée ; raffinements ultérieurs uniquement source |
| Résilience des chemins Windows/execution alias | Implémentée/en stabilisation | Transfert long/profond r5 PASS ; refus d’alias malveillant/étranger testé automatiquement en fail-closed |
| Component/Inspector | Planifiés | Pas d’ajout/retrait général de Component ni synchronisation SerializedProperty |
| Prefab/Asset général | Planifiés | Pas un parcours actuellement pris en charge |
| Récupération persistante après redémarrage serveur/session | Planifiée | Autorité/session en mémoire |
| NAT Internet/relay automatiques | Recherche/futur | Sans WebRTC, ICE, STUN, TURN, relay, découverte ni traversée NAT automatique |

## Clôtures physiques du r5 exact

Ce tableau remplace l’ancien texte présentant ces blocages comme en attente de validation physique.

| Issue | Résultat et limite restante |
| --- | --- |
| [#67](https://github.com/Eun-si123/teamforge-unity-collab/issues/67) | **PASS** : édition/sauvegarde légitimes, fermeture Unity Guest, réouverture du même Active vérifié et reconnexion sans `guest_handoff_mismatch`. Rejet d’identités nouvelles/non vérifiées protégé par code strict et régressions automatiques |
| [#68](https://github.com/Eun-si123/teamforge-unity-collab/issues/68) | **PASS** : nouveau Guest reçoit Hierarchy/Transform/Lock autoritatifs et Transform ultérieur sans faux conflit protégé. Plus de scénarios utiles ; blocage initial clos |
| [#74](https://github.com/Eun-si123/teamforge-unity-collab/issues/74) | **PASS** : côté perdant de contention restauré à l’état autoritatif, collaboration utilisable. UX du verrou d’autrui séparée dans #79 |
| [#69](https://github.com/Eun-si123/teamforge-unity-collab/issues/69) | **PASS** : Launcher arrêté de force plusieurs fois en réception ; données partielles vérifiées réutilisées, reprise terminée sans l’erreur CLR/application initiale. Conserver les régressions lors de futurs changements runtime |
| [#70](https://github.com/Eun-si123/teamforge-unity-collab/issues/70) | **PARTIEL POUR L’OBJECTIF r5 / PASS POUR SEED STABLE** : nouvelle liaison TCP `5091` après Stop/Start et vrai transfert après permission pare-feu. Configuration automatique et fallback de port ultérieurs attendent le paquet exact sur PC physiques |
| [#71](https://github.com/Eun-si123/teamforge-unity-collab/issues/71) | **PASS** : destination longue/profonde déclenche l’optimisation, Unity s’ouvre et la collaboration fonctionne. Refus d’alias malveillant/étranger/reciblé couvert automatiquement en fail-closed |

Chronologies détaillées : Issues. Effet actuel sur la publication : STATUS.

## Preuves automatiques et locales

Avant fusion de PR #81, le head intégré a passé les protections consignées dans `docs/MAIN_PATCH_STATUS_2026-08-27.md` :

- CI #216 : Server, Project Peer, chargeur runtime Launcher, Windows Launcher, contrat source public **PASS**.
- Dependency Review #140 **PASS**.
- Unity Tests #73 : Lock Contention E2E, Realtime Authority E2E, Realtime Authority Chaos E2E, Project Transfer Resume E2E **PASS**.
- Ancien Unity Test Runner local : **143/143 tests exécutables localement PASS** ; deux tests serveur réel réservés CI volontairement ignorés en local.
- Récupération de contention A/B sur même machine **PASS** ; convergence Hierarchy/Transform d’arrivée tardive A/B/C **PASS**, zéro conflit protégé dans l’exécution enregistrée.

Les renforcements ultérieurs ont des tests ciblés Project Peer/Launcher/Unity et les contrôles habituels. La suite d’identité Windows a réussi sous Node 22/24 pris en charge ; le port Seed indisponible a passé la suite Project Peer complète dans l’environnement Windows reproduit. Cela renforce le code actuel, sans prouver les octets publiés avant correction.

## Preuves sur deux PC physiques

Base du 2026-08-22 : Host→invitation signée→nouveau Guest→authentification→transfert direct→confiance Publisher→Active vérifié→connexion Unity ; Presence/Transform bidirectionnel ; contention normale ; Hierarchy même Scene créer/renommer/reparenter/ordonner les frères/supprimer. Sortie/réouverture Guest non sauvegardé avec récupération Hierarchy/Transform/Lock depuis la session toujours active. Coupure TCP Coordinator suivie de retry/reconnexion automatique sans redémarrer Unity.

Le 2026-08-31, le ZIP/SHA r5 exact a clos sur deux PC les scénarios sauvegarde/reconnexion, arrivée tardive, réception/reprise répétée, chemins longs et contention. Seed `5091` Stop/Start et transfert LAN réel réussis ; l’autorisation initiale du pare-feu restait manuelle.

## Limites des preuves

Un résultat ne prouve que ce qui a été exercé. La CI source ne prouve pas un ZIP. Unity automatisé ne reproduit pas tous les ordres SceneView, processus Windows, états LAN/pare-feu ou timings du second PC. Les essais sur une machine partagent OS, pile réseau, environnement temporel et matériel. Les preuves r5 ne valident pas main ultérieur. Version seule ≠ identité des octets : nom exact/SHA-256 requis. Un bug clos ne valide pas physiquement toute modification ultérieure du sous-système. Les notes historiques gardent leur validité pour leur instantané, sans remplacer STATUS actuel.

## Conditions restantes avant une alpha générale

1. Conserver les clôtures r5 #67/#68/#69/#71/#74 comme terminées.
2. Publier un nouveau candidat immuable si main est distribué.
3. Sur cet artefact précis, valider configuration pare-feu neuve, portée/cycle limités des règles, fallback du port préféré occupé/indisponible, accessibilité réelle du Seed annoncé, Stop/Start Host et nouveau transfert Guest.
4. Valider récupération d’identité Windows après perte de processus et maintien fail-closed face aux identités ambiguës/conflictuelles.
5. Smoke sur extraction neuve Host→nouveau Guest→collaboration ; ne pas hériter par hypothèse des preuves r5.
6. Garder nom/SHA/identité source exacts et seulement les scénarios réellement exercés.
7. Poursuivre les guides installation/mise à jour/désinstallation et obtenir tests/revues d’autres personnes que le créateur avant de larges affirmations de fiabilité.

Un redémarrage serveur est **déconnexion/fail-closed/récupération dans une nouvelle session**, pas un test de persistance : la récupération durable d’autorité/session n’est pas implémentée.

## Sources responsables

Capacités/blocages : [STATUS anglais](STATUS.md) ; versions : [contrat](../release-contract.json) ; octets actuels/remplacés : [builds](../builds/README.md) + SHA Release ; parcours : [Fonctionnement](HOW_IT_WORKS.fr.md) ; avenir : [ROADMAP](ROADMAP.md) ; structure : [architecture](architecture.md) ; raisons : [architecture-decisions](architecture-decisions.md) ; scénarios : [TEST_LAB](TEST_LAB.md) ; bugs : Issues ; anciens essais : notes datées. Les documents détaillés non traduits restent en anglais.
