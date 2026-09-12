# Fonctionnement de TeamForge

Cette page explique **ce qui se passe lors de l’hébergement, de l’arrivée d’un Guest, du transfert, de l’édition d’une Scene, d’une déconnexion ou d’une récupération**. C’est une explication guidée, pas une spécification complète du protocole ni une carte du code.

Capacités/blocages : [État](STATUS.fr.md) ; topologie et confiance : [architecture](architecture.md) ; fichiers : [CODEMAP](../CODEMAP.md) ; raisons : [architecture-decisions](architecture-decisions.md). Les détails non traduits restent en anglais. [L’original anglais](HOW_IT_WORKS.md) fait référence pour le sens.

## Le modèle en 60 secondes

Deux chemins sont volontairement séparés :

- Les Unity Editor Host/Guest envoient les opérations temps réel par WebSocket à Session Authority du Server.
- Host Unity utilise Host Project Peer/Seed ; Guest Launcher utilise Guest Project Peer. Les peers échangent les données directement par HTTP ; Guest Peer remet l’Active vérifié à Guest Unity.
- Server coordonne les métadonnées signées avec les deux peers sans devenir un relais de fichiers.
- Guest n’ouvre rien avant les contrôles de confiance, intégrité, activation et transfert à Unity.

Les gros transferts restent séparés du trafic sensible à la latence, avec une seule autorité temps réel claire.

## Processus principaux

### Paquet Unity Editor

Il fournit parcours Host, cycle de connexion, Presence, Transform/Lock et Hierarchy même Scene pris en charge, diagnostics/récupération et application de l’état distant approuvé à la Scene locale. Le client **observe l’autorité** : une valeur locale n’est pas autoritative simplement parce qu’elle existe dans un Editor.

### TeamForge Server

**Session Authority** gère membres, révision/ordre partagé, locks/leases, état Scene pris en charge conservé, protection replay/idempotence et effets temps réel. **Project Coordinator** gère les métadonnées signées projet/publisher/baseline/peer. Server ne stocke ni ne relaie les données normales Manifest/File/Chunk.

### Project Peer

Il gère invitations signées, manifestes/hashes déterministes, HTTP direct, reprise vérifiée, staging, révisions Active immuables, sûreté fichiers/chemins et confiance projet/publisher. Un téléchargement réussi ne suffit pas à activer : toute la chaîne de vérification et confiance reste nécessaire.

### Windows Guest Launcher

Un nouveau Guest commence hors Unity car il peut ne pas avoir de projet. Launcher vérifie Runtime inclus, invitation et confiance, reçoit via Peer, valide Active final et Unity requis puis remet le projet à Unity. Le Guest empaqueté normal n’a pas à installer ni manipuler manuellement Node.js/npm système.

Le code Launcher actuel peut créer un **support bundle local manuel** : ZIP d’observation limité et expurgé. Aucun envoi automatique, aucune autorité accordée, aucun contournement des contrôles invitation, confiance, activation, Runtime, chemin ou remise à Unity. La présence dans un paquet dépend de l’artefact exact ; [État](STATUS.fr.md) et [builds](../builds/README.md) distinguent code et publication.

## Démarrage du Host

1. Choisir **Publish & Start**.
2. Unity vérifie projet local et prérequis de Scene sauvegardée.
3. Peer prépare une baseline déterministe et les identités d’intégrité des fichiers/chunks.
4. Host Peer démarre le Seed direct.
5. Métadonnées projet/publisher/baseline/peer coordonnées avec Server.
6. Collaboration Invite signée créée ; Host prêt pour les Guests.

D’autres contrôles fail-closed existent. **Host Ready signifie plus qu’un port ouvert** : les contrats de transfert et de session nécessaires sont établis. L’invitation n’est pas destinée à transporter code d’accès, clé privée de signature ou chemin local arbitraire. Un code d’accès éventuel est partagé séparément.

## Arrivée d’un nouveau Guest

1. Ouvrir Windows Guest Launcher et vérifier Runtime inclus.
2. Charger/coller l’invitation, valider structure et signature.
3. Examiner identité/confiance Project/Owner/Publisher.
4. Contacter Host/Seed coordonné ; recevoir descriptor/manifest/inventory.
5. Télécharger seulement les chunks nécessaires ; vérifier intégrité chunk/fichier/manifeste/projet.
6. Construire dans staging et vérifier le candidat complet.
7. Créer une révision Active immuable et déplacer le petit pointeur de projet courant.
8. Valider l’exécutable Unity requis et la remise finale ; ouvrir le projet vérifié.

Un répertoire partiellement téléchargé ne devient pas arbitrairement le projet courant. L’Active précédent vérifié peut subsister pendant une nouvelle réception ou un échec d’activation.

### Reprise fondée sur la vérification

Après interruption, le contenu déjà vérifié peut être réutilisé lorsque le contrat le permet. Ce n’est pas faire confiance à n’importe quel fichier présent : hashes et contrat d’activation restent déterminants.

## Édition d’un objet Scene pris en charge

1. L’utilisateur déplace GameObject ; le service Transform observe le changement.
2. Résoudre l’identité canonique autoritative de l’objet.
3. Vérifier lock/lease et autorité de connexion ; envoyer Transform par WebSocket.
4. Session Authority valide l’opération et applique ordre, révision et idempotence.
5. Diffuser l’effet approuvé aux autres clients.
6. Le destinataire met à jour Authority View ; Unity applique le Transform distant approuvé en sécurité.

**Identité :** les Editor doivent désigner le **même objet logique**, pas seulement un nom ou chemin Hierarchy identique. Une Scene sauvegardée utilise l’identité Unity stable ; les objets de session pris en charge peuvent recevoir une identité TeamForge après liaison autoritative. L’ambiguïté échoue en fail-closed au lieu de deviner par nom, index de frère ou chemin.

**Autorité :** Server décide de l’état partagé accepté. Les clients transmettent des intentions et appliquent les résultats, sans vérités concurrentes.

**Révision/ordre :** les opérations acceptées font progresser l’ordre commun. La révision permet de raisonner sur état ancien, arrivée tardive, replay et état attendu lors de l’évaluation.

**Lock/lease :** l’autorité contrôle les verrous pour éviter les écrasements simultanés silencieux. Les leases expirent si un client disparaît, au lieu de devenir permanents.

**Replay/idempotence :** distinguer la répétition légitime d’une même opération d’une autre réutilisant l’identité. Deux livraisons ne doivent pas modifier deux fois l’état.

## Modifications Hierarchy

Création/suppression/renommage/reparentage/ordre des frères dans la même Scene empruntent un chemin autoritatif distinct, pas un faux Transform. Transform dépend de la structure : avec parents/identités différents, les mêmes valeurs locales peuvent produire des Scenes différentes. Ne pas en déduire synchronisation générale Component/Inspector/Prefab/Asset ou structures arbitraires inter-Scenes ; voir [État](STATUS.fr.md).

## Reconnexion et époques

Se reconnecter ne prouve pas la validité de l’ancienne autorité. Perte de connexion, abandon de l’autorité liée à celle-ci, reconnexion/handshake, réception des capacités négociées et de l’état actuels, nouvelle liaison des objets pour la nouvelle époque, reprise seulement quand l’état requis est prêt. Alias persistés et identités en cache aident à résoudre, sans accorder d’autorité seuls.

## Échec et récupération

Préserver l’état vérifié plutôt que forcer un état inconnu :

- Runtime endommagé : arrêter avant exécution de code non vérifié ;
- invitation invalide/conflictuelle : garder la liaison de projet existante ;
- échec de transfert : préserver le progrès vérifié réutilisable autorisé ;
- échec d’activation : ne pas remplacer l’Active précédent vérifié ;
- problème de chemin Unity : uniquement stratégie TeamForge séparément validée ;
- baseline/identité divergente : demander rapprochement/mise à jour plutôt que deviner ;
- processus inconnu sur le port voulu : ne pas le tuer pour récupérer le port.

La récupération dépend de **l’état**. Retry, Paste New Invite, Use Latest Project, Open Existing Verified Project et Choose Unity ne sont proposés que lorsqu’un sens sûr est défini.

**Les diagnostics observent, ils ne confèrent pas d’autorité de récupération.** Copie diagnostic/ZIP manuel décrivent l’exécution. Sauvegarder ne change ni Project, ni tentative, ni confiance Publisher, ni activation, ni contrôles. Le bundle recueille un aperçu sûr limité, pas des données générales projet/machine ; il faut néanmoins le relire avant partage public.

## Pourquoi séparer les chemins ?

La collaboration profite de petits messages autoritatifs ordonnés. Le transfert initial implique fichiers nombreux, gros flux, reprises, hashes, staging et disque. La séparation évite un goulot caché sur Server et clarifie sécurité/échecs.

En contrepartie Guest doit réellement atteindre Host Peer. Cela convient au même PC, à une LAN accessible ou à une VPN gérée. Découverte Internet/NAT/relay automatiques sont un autre problème futur de transport, non une promesse du terme P2P.

## Emplacement et durée des états

| État | Propriétaire/durée |
| --- | --- |
| Session Authority | Mémoire Server pour la session vivante |
| Registre de coordination | Mémoire Server |
| Client Authority View | Connexion Unity actuelle |
| Contenu de transfert/staging | Stockage géré Project Peer |
| Révisions Active vérifiées | Stockage projet géré durable |
| Pointeur Active courant | Petites métadonnées durables |
| Historique diagnostic Launcher | Exécution courante, bornée |
| Support bundle manuel | ZIP local créé par utilisateur, borné/expurgé, sans envoi automatique |

Un projet téléchargé durable n’implique pas un historique d’autorité durable ; un diagnostic sauvegardé ne devient pas autorité. Cette distinction compte pour redémarrer, reconnecter, reprendre ou récupérer.

## Suivre le comportement dans le code

[CODEMAP](../CODEMAP.md) conserve les fichiers/tests exacts pour que cette explication survive aux refactorisations. Chemins typiques : connexion → Unity `TeamForgeConnectionService` + hôte WebSocket Server ; Transform/Lock → service Transform + Authority View + Session Authority ; Hierarchy → service Unity + modèle Server/Session Authority ; transfert → orchestrateurs Peer Host/Guest + source directe + content store ; démarrage/récupération Guest → Windows Launcher + Launcher Core + orchestrateur Guest ; support → UI diagnostic + bundle/expurgation Core ; résilience des chemins → Launcher Core + contrat partagé Project Peer.
