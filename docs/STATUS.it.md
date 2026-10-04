# Stato attuale di TeamForge

[English](STATUS.md) · [Come funziona](HOW_IT_WORKS.it.md)

_Questa traduzione di anteprima è stata confrontata con il documento canonico inglese `STATUS.md` del 2026-10-04. Per prove dettagliate, Issue e decisioni correnti, fa fede la versione inglese._

> **Anteprima pubblica iniziale: non usare TeamForge come unica copia o unico meccanismo di recupero di un Unity Project importante.** Mantieni backup e preferisci Projects di prova sacrificabili.

## Riepilogo attuale

- Linea prodotto: `0.5.1`
- Source lineage: `0.5.1-wp5.1-path-resilience`
- Ultimo candidato pubblicato: `v0.5.1-prealpha-wp5.1-r7`
- Source commit r7: `d88ca4c41ecf1f9cc7aa5d349960f407f158ce9a`
- ZIP Windows: `Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r7-win-x64.zip`
- SHA-256: `a710acd3cd7189c3f44ae1b4ee46a15239313c850ad7f6982e3a58f2492a13aa`
- Target: Windows x64
- Stato di release: **FIELD BLOCKED**
- Linea Unity: `6000.3` (Editor di test registrato: `6000.3.21f1`)
- Realtime / Project Transfer / Project Manifest: **v1**

## Limite delle prove r7

r7 è stato pubblicato il 2026-10-03 dal commit sopra e ha poi superato la **Exact Release Validation** Windows. L’automazione ha riscaricato il ZIP del Release, verificato SHA-256 e ogni hash del release manifest, eseguito un’estrazione nuova in un percorso con caratteri coreani e spazi da una directory di lavoro diversa e verificato Runtime/Node incluso, comportamento fail-closed del Launcher, Windows path resilience e junction reali.

Questa è **evidenza automatizzata sul pacchetto esatto**. In un successivo test fisico con Host r6 e Guest r7 esatto, il Guest ha riutilizzato il managed root esistente senza `destination_contains_unmanaged_content`; dopo aver cambiato il profilo della LAN fidata dell’Host da Public a Private, il flusso è proseguito attraverso Publisher trust, Project receive e apertura di Unity fino a una connessione TeamForge riportata dall’utente. Non dimostra ancora r7 esatto su entrambi i PC, un nuovo onboarding UAC senza elevazione, il fallback della porta Seed o il recupero fisico di Project identity dopo perdita anomala del processo. Per questo resta FIELD BLOCKED.

L’evidenza fisica r5 del 2026-08-31 resta valida per gli scenari realmente eseguiti: reconnect, late join, receive/resume, long path, lock contention e Seed `5091`/trasferimento. La pubblicazione di r7 non modifica i byte o i risultati storici di r5.

## Ambito attuale

Presence, Selection, sincronizzazione Transform, lock/ownership di base, operazioni Same-Scene Hierarchy supportate, Project transfer P2P diretto, UX diagnostica/recupero e Windows path resilience sono implementati o in stabilizzazione. r7 include inoltre Windows firewall onboarding post-r5, fallback per Seed port occupata/non disponibile, Windows Project identity crash recovery, diagnostica aggiuntiva e feedback SceneView `TeamForge · Locked by <owner>`.

Sincronizzazione generale Component/Inspector, Prefab/Asset generici, recovery persistente dopo restart server/session e NAT traversal/relay Internet automatico non sono attualmente supportati.

## Verifica fisica rimanente

1. Estrarre **r7 esatto** su due PC Windows puliti e verificare Firewall onboarding/UAC, regole ristrette a Private + `LocalSubnet` e relativo lifecycle.
2. Forzare conflitto/non disponibilità della Seed port preferita; verificare che l’endpoint annunciato dopo fallback sia realmente raggiungibile, insieme a Host Stop/Start e Fresh Guest transfer.
3. Simulare perdita anomala del processo durante Project identity e confermare recovery sicura mantenendo fail closed per identità ambigue/conflittuali.
4. Eseguire Fresh Host → Fresh Guest → Unity realtime smoke e controllare che il feedback foreign-lock sia chiaro e scompaia dopo release/takeover.
5. Mantenere #182 come monitoraggio CI intermittente senza mascherarlo con retry/skip; #79 resta il follow-up UX per movimento SceneView transitorio.

## Fonti di riferimento

Dettagli su capacità, blocker ed evidenze: [English STATUS](STATUS.md); selezioni esatte: [`release-contract.json`](../release-contract.json); identità dei byte pubblicati: [`builds/README.md`](../builds/README.md) e SHA-256 del GitHub Release.
