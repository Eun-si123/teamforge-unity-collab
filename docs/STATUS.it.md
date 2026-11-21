# Stato attuale di TeamForge

> **r11 release update (2026-11-21):** [r11 Windows test ZIP](https://github.com/Eun-si123/teamforge-unity-collab/releases/tag/v0.5.1-prealpha-wp5.1-r11) passed exact ZIP validation, but new M1–M4 functions have NOT passed two-physical-PC Windows tests; **FIELD BLOCKED** remains. The text below is a dated translation snapshot; refer to the [current English STATUS](STATUS.md) for up-to-date claims.

[English](STATUS.md) · [Come funziona](HOW_IT_WORKS.it.md)

_Questa traduzione di anteprima è stata confrontata con il documento canonico inglese `STATUS.md` del 2026-11-20. Per prove dettagliate, Issue e decisioni correnti, fa fede la versione inglese._

**Aggiornamento del codice 2026-11-20:** M4 (#572) integra il recupero facoltativo delle Session via SQLite. I test r9/r10 su due PC Windows reali per collaborazione di base e riconnessione sono già stati eseguiti e segnalati PASS; non verificavano M4. Il pacchetto r10 rimane invariato e lo stato è **FIELD BLOCKED**.


> **Anteprima pubblica iniziale: non usare TeamForge come unica copia o unico meccanismo di recupero di un Unity Project importante.** Mantieni backup e preferisci Projects di prova sacrificabili.

> **2026-10-20 r9 field evidence:** Published r9 passed exact-release validation; user-reported two-PC basic collaboration and Guest reconnect PASS. Full recovery/negative field gate remains BLOCKED. [Current detail](https://github.com/Eun-si123/teamforge-unity-collab/blob/main/docs/STATUS.md).
> **2026-11-04 r10 user-reported two-PC field signal (not a package certification):** Basic Host/Guest collaboration, receive/reconnect, access-code rejection and one long destination were reported PASS; separate installed ZIP hashes were **not** checked on both machines. The published r10 ZIP passed [automated Exact Release Validation #41630492102](https://github.com/Eun-si123/teamforge-unity-collab/actions/runs/41630492102), but an actual Guest Wi-Fi/NIC outage was **NOT RUN** ([#457](https://github.com/Eun-si123/teamforge-unity-collab/issues/457)) and repeated Launcher startup exposed a defect (fixed in later source [#456](https://github.com/Eun-si123/teamforge-unity-collab/pull/456), **not** in r10). Full field readiness is **FIELD BLOCKED**. [Dated evidence](PHYSICAL_FIELD_EVIDENCE_2026-11-04_R10.md).

## Riepilogo attuale

- Linea prodotto: `0.5.1`
- Source lineage: `0.5.1-wp5.1-path-resilience`
- Ultimo candidato pubblicato: `v0.5.1-prealpha-wp5.1-r11`
- Source commit r11: `5868efe02975aa94b2acd79f5dec39a7b830aa26`
- ZIP Windows: `Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r11-win-x64.zip`
- SHA-256: `28774bccb9fb20da0d72fce38d9bab7645dac1b876de182fbd33ee421170a989`
- Target: Windows x64
- Stato di release: **FIELD BLOCKED**
- Linea Unity: `6000.3` (Editor di test registrato: `6000.3.21f1`)
- Realtime / Project Transfer / Project Manifest: **v1**

## Integrazione M1 nei sorgenti: modifica condivisa dei Collider

M1 richiede l’attivazione esplicita nei sorgenti e non è incluso nel ZIP r10 pubblicato. Condivide trigger, center e size/radius di BoxCollider/SphereCollider in Scene salvate senza Prefab tramite il percorso reale: verifica dei byte Scene/meta firmati → Server Authority → WebSocket → Unity Editor. Dopo l’ammissione iniziale, le modifiche continue senza salvataggio usano il ledger del server, revision/history comuni e il lock GameObject. La finestra Collider Collaboration offre Undo/Redo condizionale delle proprie modifiche e una casella di recupero per esaminare e reinviare esplicitamente i valori locali non confermati. Commit del server, rapporto di applicazione dell’Editor e salvataggio su disco sono stati distinti.

Le prove hanno quattro fasi. **Implementazione**: M1 è stato integrato in main tramite [PR #533](https://github.com/Eun-si123/teamforge-unity-collab/pull/533). **Validazione automatica**: i test reali Node WebSocket passano. **Integrazione Unity**: la [CI del sorgente esatto](https://github.com/Eun-si123/teamforge-unity-collab/actions/runs/43329700733) ha superato modifica Collider, Undo condizionale e riconnessione con un Editor reale e un peer Node su tre versioni di Unity; Unity localmente su Linux resta NOT RUN. **Pacchetto e Windows fisico**: due Editor fisici e un nuovo pacchetto restano **NOT RUN**. Lo ZIP r10 pubblicato non cambia e lo stato resta **FIELD BLOCKED**. Aggiunta/rimozione M2 [#559](https://github.com/Eun-si123/teamforge-unity-collab/pull/559) e correzione late join [#565](https://github.com/Eun-si123/teamforge-unity-collab/pull/565) sono state integrate in main il 2026-11-18 come funzione sorgente opt-in, disattivata per impostazione predefinita. La CI con un Editor reale e peer Node ha superato tre versioni Unity; due Editor fisici e un nuovo pacchetto restano **NOT RUN**. Il r10 pubblicato non include M1/M2. Il 2026-11-19 M3 per creazione/eliminazione condivisa di Cube/Sphere integrati è stato unito a main con PR #569, come funzione sorgente opt-in. La CI con Editor reale e peer Node ha superato tre versioni Unity (40 controlli PR). Due Editor fisici e nuovo pacchetto restano NOT RUN; r10 pubblicato non contiene M3, stato FIELD BLOCKED.

Limiti: una Scene per Session, 128 Session conservate in memoria, 512 Collider/1536 proprietà e valori finiti ±100/0–100. I campi non supportati restano locali. Aggiungere/rimuovere Component, Prefab e cancellare il proprietario di un Collider ammesso o i suoi antenati richiedono M2 e vengono rifiutati nel percorso M1 attivo. Gli editor devono negoziare e aderire alla capacità compatibile. Il ledger resta in memoria dopo la disconnessione di tutti i peer, ma **si perde al riavvio del server se M4 non è abilitato**. La modalità M4 facoltativa ora integrata salva in SQLite lo stato confermato delle Session. Due Unity Editor, late join a tre, salvataggio/riapertura, otto Editor per un’ora e l’artefatto Windows esatto restano verifiche separate. M2/M3/M4 sono ora integrati nel codice; le prove fisiche delle nuove funzionalità restano separate. Vedi lo [STATUS inglese](STATUS.md) e la [configurazione](../server/README.md).

## Pubblicazione r8 e limiti delle prove

r8 è stato pubblicato il 2026-10-10 e contiene le correzioni del PR #209 per la disponibilità di Direct Seed, l'apertura verificata di Existing-Active e il rifiuto delle cartelle radice annidate. Lo ZIP pubblicato ha superato Windows Exact Release Validation (esecuzione 38019297086), ma **r8 non è ancora stato provato su due PC Windows fisici**; lo stato rimane **FIELD BLOCKED**. Le prove r7 seguenti sono storiche e non dimostrano l'esito delle correzioni r8 sul campo. I PR #217 e #219 sono successivi e non sono inclusi nello ZIP r8.

## Limite delle prove r7

r7 è stato pubblicato il 2026-10-03 dal commit d88ca4c41ecf1f9cc7aa5d349960f407f158ce9a e ha poi superato la **Exact Release Validation** Windows. L’automazione ha riscaricato il ZIP del Release, verificato SHA-256 e ogni hash del release manifest, eseguito un’estrazione nuova in un percorso con caratteri coreani e spazi da una directory di lavoro diversa e verificato Runtime/Node incluso, comportamento fail-closed del Launcher, Windows path resilience e junction reali.

Questa è **evidenza automatizzata sul pacchetto esatto**. In un successivo test fisico con Host r6 e Guest r7 esatto, il Guest ha riutilizzato il managed root esistente senza `destination_contains_unmanaged_content`; dopo aver cambiato il profilo della LAN fidata dell’Host da Public a Private, il flusso è proseguito attraverso Publisher trust, Project receive e apertura di Unity fino a una connessione TeamForge riportata dall’utente. Non dimostra ancora r7 esatto su entrambi i PC, un nuovo onboarding UAC senza elevazione, il fallback della porta Seed o il recupero fisico di Project identity dopo perdita anomala del processo. Per questo resta FIELD BLOCKED.

L’evidenza fisica r5 del 2026-08-31 resta valida per gli scenari realmente eseguiti: reconnect, late join, receive/resume, long path, lock contention e Seed `5091`/trasferimento. La pubblicazione di r7 non modifica i byte o i risultati storici di r5.

## Blocchi r7-on-Host successivi e nuovi test con r8

I test fisici successivi hanno mostrato `baseline_unavailable` mentre Host restava Ready senza un Direct Project Peer individuabile, una `DirectoryNotFoundException` dovuta a percorsi lunghi aprendo un Project verificato esistente. La revisione del Source ha inoltre individuato il rischio di UUID annidati scegliendo la cartella di un singolo Project come Projects root.

La PR #209 è stata integrata in `main` il 2026-10-08; le correzioni sono **incluse nel ZIP r8 pubblicato**. r8 ha superato Windows Exact Release Validation (esecuzione 38019297086), ma occorrono ancora test su due PC Windows fisici: rimuovere Ready quando manca il Direct Seed, riaprire Existing-Active tramite il percorso breve e rifiutare una cartella Project UUID come Projects root. La causa iniziale della scomparsa del Seed resta incerta. Il PASS misto r6/r7 precedente vale solo per il suo ambito originario; lo stato resta **FIELD BLOCKED**.

[PR #209](https://github.com/Eun-si123/teamforge-unity-collab/pull/209) · [English evidence/status](https://eun-si123.github.io/teamforge-unity-collab/status/#later-r7-on-host-blockers-now-packaged-for-r8-retest)

## Ambito attuale

Presence, Selection, sincronizzazione Transform, lock/ownership di base, operazioni Same-Scene Hierarchy supportate, Project transfer P2P diretto, UX diagnostica/recupero e Windows path resilience sono implementati o in stabilizzazione. r7 include inoltre Windows firewall onboarding post-r5, fallback per Seed port occupata/non disponibile, Windows Project identity crash recovery, diagnostica aggiuntiva e feedback SceneView `TeamForge · Locked by <owner>`.

La sincronizzazione generale Component/Inspector, Prefab/Asset generici e il NAT traversal/relay Internet automatico non sono ancora supportati. La persistenza Session M4 facoltativa è nel codice, ma senza test su due Editor fisici o nuovo pacchetto.

## Verifica fisica rimanente

1. Estrarre **r11 esatto** su due PC Windows puliti e verificare Firewall onboarding/UAC, regole ristrette a Private + `LocalSubnet` e relativo lifecycle.
2. Forzare conflitto/non disponibilità della Seed port preferita; verificare che l’endpoint annunciato dopo fallback sia realmente raggiungibile, insieme a Host Stop/Start e Fresh Guest transfer.
3. Simulare perdita anomala del processo durante Project identity e confermare recovery sicura mantenendo fail closed per identità ambigue/conflittuali.
4. Eseguire Fresh Host → Fresh Guest → Unity realtime smoke e controllare che il feedback foreign-lock sia chiaro e scompaia dopo release/takeover.
5. Mantenere #182 come monitoraggio CI intermittente senza mascherarlo con retry/skip; #79 resta il follow-up UX per movimento SceneView transitorio.

## Fonti di riferimento

Dettagli su capacità, blocker ed evidenze: [English STATUS](STATUS.md); selezioni esatte: [`release-contract.json`](../release-contract.json); identità dei byte pubblicati: [`builds/README.md`](../builds/README.md) e SHA-256 del GitHub Release.
