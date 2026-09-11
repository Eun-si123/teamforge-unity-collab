# Compatibilité de TeamForge

Cette page décrit **les limites de compatibilité et de topologie pour les lecteurs**.

- Sélections exactes actuelles du produit, du runtime et des protocoles → [`../release-contract.json`](../release-contract.json)
- Validation et maturité actuelles → [STATUS.md](STATUS.md)
- Identité de l’artefact empaqueté → [`../builds/README.md`](../builds/README.md) + SHA-256 exact de la Release

Évitez de recopier dans plusieurs documents les numéros de correctif des outils ou runtimes, qui évoluent rapidement. Le contrat de version définit ces choix exacts.

## Avant de tester

Utilisez un projet jetable et conservez des sauvegardes : TeamForge est une première préversion publique. [STATUS.md](STATUS.md) définit les limites actuelles de validation sur le terrain. Le tableau des plateformes distingue la cible des paquets des exigences de compilation et de travail sur les sources.

Les exigences minimales en CPU, RAM, GPU, disque, bande passante et latence n’ont pas encore été établies par des tests contrôlés. Le bon fonctionnement d’un prototype ne constitue pas une recommandation de configuration minimale.

Les Guest doivent pouvoir joindre le Server configuré et le point d’accès Project Peer annoncé par le Host. Une invitation signée ne crée pas de connectivité réseau. Utilisez la même machine, un LAN accessible ou un VPN administré ; aucun mécanisme automatique de traversée d’Internet ni relais n’est fourni.

## Compatibilité du produit et des protocoles

Les composants TeamForge sont destinés à évoluer comme une même ligne de produit compatible, plutôt qu’à mélanger indépendamment les versions de Server, Project Peer, Launcher et du paquet.

L’architecture actuelle sépare :

- l’autorité de collaboration en temps réel via le WebSocket du TeamForge Server configuré ;
- la préparation initiale du projet et la coordination des métadonnées ;
- le transfert direct des données par Project Peer ;
- l’intégrité du Runtime Host/Guest et du Launcher empaquetés.

La compatibilité des versions de protocole ou de schéma n’est additive que si la sémantique existante reste compatible. Les numéros exacts retenus relèvent de `release-contract.json`.

Ne mélangez pas les manifestes Runtime/Launcher générés ni les binaires de différents candidats empaquetés au seul motif qu’ils affichent la même version du produit.

## Compatibilité avec Unity

La ligne de produit Unity actuellement prise en charge est **Unity 6000.3**.

Un correctif précis de l’Editor ne peut être présenté comme validé que si des preuves ont été enregistrées pour les sources ou le candidat visé. Le dernier correctif disponible chez Unity n’est pas automatiquement testé ou pris en charge.

Le choix exact d’Editor consigné dans les tests figure dans `release-contract.json` ; les preuves actuelles sont résumées dans [STATUS.md](STATUS.md).

## Compatibilité du développement et du runtime

Les personnes travaillant sur les sources doivent utiliser les plages Node/npm/.NET/outils définies par `release-contract.json` et la configuration de verrouillage et de compilation du dépôt.

Ce sont des **exigences de sources et de compilation**, pas les exigences habituelles d’installation pour les utilisateurs du parcours Host/Guest empaqueté. Celui-ci utilise des composants runtime fournis ou autonomes conformément au contrat de version actuel.

Une nouvelle famille de versions majeures de Runtime ou de chaîne d’outils doit faire l’objet d’une décision de compatibilité et d’une validation explicites. Une installation réussie sur une machine ne suffit pas à les déduire.

## Topologie prise en charge

Les topologies actuellement prises en charge ou prévues comprennent :

- le WebSocket du TeamForge Server configuré pour l’autorité en temps réel ;
- le transfert HTTP direct par Project Peer sur le même PC, un LAN accessible ou un VPN administré ;
- un mode explicite limité au bouclage sur le même PC ;
- une écoute authentifiée hors bouclage, avec une adresse d’hôte concrète annoncée au Guest ;
- le parcours Windows Host/Guest empaqueté avec un Runtime fourni et vérifié.

Ne sont pas actuellement fournis comme topologies prises en charge :

- WebRTC / RTCDataChannel ;
- ICE / STUN / TURN ;
- traversée automatique de NAT ;
- relais / basculement automatique du transport ;
- découverte automatique des pairs ;
- autorité en temps réel sans serveur ou intégrée ;
- déploiement sur l’Internet public non fiable avec un système complet d’identité utilisateur et d’autorisation.

Dans la documentation actuelle de TeamForge, `P2P` désigne le **transfert direct de données par Project Peer**, pas une connectivité P2P automatique sur Internet.

## Tableau des plateformes

| Périmètre | État de compatibilité |
| --- | --- |
| Runtime fourni Windows x64 / Guest Launcher | Orientation actuelle des paquets ; le candidat exact reste soumis aux conditions de validation terrain de STATUS |
| Unity 6000.3 | Ligne actuelle de Unity |
| Correctif exact de Unity enregistré | Voir `release-contract.json` + preuves dans STATUS |
| Autres correctifs de Unity 6000.3 | Nouvelle référence et validation distincte nécessaires avant de les déclarer testés |
| Launcher autonome macOS/Linux | Non empaqueté comme candidat actuel équivalent |
| Docker/Compose | Option pour les sources ou le serveur ; pas le parcours Host empaqueté habituel ni une condition actuelle de publication |
| Authenticode | Le statut de distribution et de signature relève de STATUS et de la documentation de l’artefact actuel |

## Stockage géré sous Windows dans les sources actuelles

Les sources actuelles exigent une racine gérée locale fixe NTFS/ReFS pour le verrouillage de l’identité du projet sous Windows. Les racines réseau, indisponibles ou non vérifiées sont refusées. C’est une condition du stockage géré de TeamForge, pas une nouvelle exigence générale pour les projets Unity. Consultez [STATUS.md](STATUS.md) pour la distinction entre sources et candidat publié, ainsi que [l’implémentation responsable](../project-peer/src/project-identity-lock.mjs).

## Affirmations de compatibilité et historique

Les rapports historiques de phases, d’avancement et de tests s’appliquent aux sources ou artefacts qu’ils ont enregistrés. Ils ne constituent pas des preuves de compatibilité actuelles au seul motif que la version affichée ressemble à la ligne actuelle.

Lorsque l’identité exacte des octets compte, utilisez le nom du fichier de la Release + SHA-256 plutôt que la seule version du produit.
