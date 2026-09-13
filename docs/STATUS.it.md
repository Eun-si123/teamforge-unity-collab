# Stato attuale di TeamForge

[English](STATUS.md) · [Come funziona](HOW_IT_WORKS.it.md)

_Revisione della documentazione originale: 2026-09-10 UTC. Confronto con il sorgente su `main`, inclusi gli interventi successivi a r5 su rete Windows, diagnostica e identità del Project, con l'artefatto r5 pubblicato e con i risultati fisici esatti del 2026-08-31. Le prove del pacchetto e quelle del sorgente più recente restano distinte._

> **Anteprima pubblica iniziale — non usare TeamForge come unica copia o unico meccanismo di recupero di un progetto Unity importante.** I blocchi Windows WP5.1 originali hanno ricevuto ampie verifiche fisiche sull'esatto r5, ma `main` include comportamenti di rete/identità più recenti, non ancora verificati insieme in un esatto pacchetto sostitutivo su PC fisici. Conservare backup e preferire progetti sacrificabili per i test.

Lo [English](STATUS.md) è la fonte umana canonica per capacità e prontezza al rilascio. Gli altri documenti devono rimandarvi, senza mantenere elenchi concorrenti di blocchi. Selezioni esatte: [release-contract.json](../release-contract.json); identità dei byte e build superate: [builds/README.md](../builds/README.md); discussioni e riproduzioni storiche: GitHub Issues. I documenti di dettaglio non tradotti restano in inglese.

## Quadro attuale

- Linea prodotto: `0.5.1`; linea sorgente: `0.5.1-wp5.1-path-resilience`.
- Ultimo candidato pubblicato come pacchetto: `v0.5.1-prealpha-wp5.1-r5`.
- Commit sorgente/tag r5: `a97b6ba5649e2888b909bf3c99c64acfd7042ba6`.
- ZIP Windows r5: `Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r5-win-x64.zip`.
- SHA-256: `5944abf2263502ee40f49d0ac2c8a9826a809dc4cd1b20c9edf82f94ba35f8cc`.
- Destinazione del pacchetto: Windows x64; stato di rilascio: **FIELD BLOCKED**, requisiti di verifica sul campo ancora aperti.
- Linea Unity: `6000.3`; Editor di test registrato per il candidato: `6000.3.21f1`.
- Realtime Protocol, Project Transfer Protocol e Project Manifest Schema: **v1** ciascuno.

## Sorgente e candidato pubblicato

Le correzioni WP5.1 originali per #67, #68/#74, #69, #70 e #71 sono state integrate tramite PR #81. r5 proviene dal commit sopra e include anche l'integrazione Launcher **Save support bundle**, successiva a r4.

Il 2026-08-31 l'esatto r5 è stato provato su due PC Windows fisici: riconnessione Guest dopo salvataggio, nuovo ingresso tardivo con snapshot Transform, interruzioni ripetute di ricezione/ripresa, passaggio tramite execution alias con percorsi lunghi/profondi e recupero dal conflitto protetto causato da contesa di lock obsoleta. Dopo le autorizzazioni firewall necessarie sono stati verificati anche Host Stop/Start con riassociazione Seed TCP `5091` e un vero trasferimento Guest.

Questi scenari non attendono più la prima ripetizione fisica su r5. Ciò non include le modifiche successive nel pacchetto r5 e non rende il prodotto un'alpha generalmente installabile. Usare r5 e le prove del 2026-08-31 per le affermazioni sul pacchetto; non descriverlo come equivalente a `main` nei byte o nel comportamento. Non riaprire gli scenari conclusi solo perché vecchi testi li indicano ancora in attesa. Per distribuire `main` serve un nuovo artefatto immutabile e la verifica delle aggiunte successive a r5 su quell'artefatto.

## Rafforzamenti successivi, assenti da r5

- Configurazione firewall LAN Windows: dopo consenso esplicito dell'utente e UAC, può creare regole in ingresso ristrette per Coordinator/Seed, limitate a Private e LocalSubnet, con riconciliazione/pulizia delle regole possedute da TeamForge. r5 richiedeva autorizzazioni manuali; il nuovo percorso necessita di prove fisiche sull'esatto pacchetto.
- Seed con porta preferita/predefinita occupata o indisponibile, incluso `EACCES` nel contesto di bind Windows: Host riprova una volta con una porta assegnata dal sistema operativo e annuncia l'endpoint scelto. Esiste copertura automatizzata Windows Project Peer; il comportamento è successivo a r5.
- Creazione serializzata dell'identità Project e recupero dopo crash Windows tramite lock attivo named-pipe del sistema operativo e barriera permanente di compatibilità per vecchi writer. Suite crash/concorrenza Node 22/24 superate; nessun pacchetto pubblicato con questa modifica dispone di prove fisiche esatte.
- Pulizia dopo rifiuto Coordinator, cancellazione/scadenze HTTP, contesto diagnostico Host migliorato, log dei ruoli client WebSocket e distinzione fra inviti Launcher e codici `TF1`.

Sono fatti del sorgente/automazione, non comportamenti del pacchetto r5. Il recupero dei lock obsoleti dell'identità Project su Linux/macOS resta fuori da questa modifica Windows.

## Capacità

| Area | Sorgente attuale | Limite delle prove |
| --- | --- | --- |
| Presenza utenti connessi | Implementata/provata | Base fisica a due PC riuscita; utili test esterni più ampi |
| Selezione/contesto Editor | Implementati/provati | Utili test esterni più ampi |
| Sincronizzazione Transform | Implementata/in stabilizzazione | r5 ingresso tardivo e recupero contesa PASS; restano copertura sul campo e UX |
| Lock/ownership di base | Implementati/in stabilizzazione | r5 contesa/recupero PASS; UX con lock altrui da migliorare (#79) |
| Hierarchy nella stessa Scene: creare/eliminare/rinominare/cambiare parent/ordine | Implementata/in stabilizzazione | Sottoinsieme provato fisicamente; utile maggiore copertura |
| Bootstrap Project/Collaboration Invite | Implementati/in stabilizzazione | r5 Guest salvato PASS; recupero identità successivo senza prove di pacchetto/campo |
| Trasferimento diretto P2P | Implementato/in stabilizzazione | r5 `5091` Stop/Start e trasferimento PASS; nuovi firewall/porte senza prove sul pacchetto sostitutivo |
| Diagnostica/UX recupero | Implementate/in stabilizzazione | r5 include il support bundle attento alla privacy; perfezionamenti successivi solo nel sorgente rispetto a r5 |
| Resilienza percorsi Windows/execution alias | Implementata/in stabilizzazione | Passaggio lungo/profondo r5 PASS; rifiuto alias malevoli/estranei verificato automaticamente in modalità fail-closed |
| Component/Inspector | Pianificati | Aggiunta/rimozione generale Component e sincronizzazione `SerializedProperty` non supportate |
| Prefab/Asset generali | Pianificati | Non è un flusso attualmente supportato |
| Recupero persistente dopo riavvio server/sessione | Pianificato | Stato authority/sessione in memoria |
| Attraversamento NAT Internet/relay automatici | Ricerca/futuro | Nessun WebRTC, ICE, STUN, TURN, relay, discovery o attraversamento NAT automatico |

## Chiusure fisiche sull'esatto r5

Questi risultati sostituiscono il vecchio testo che lasciava in attesa i blocchi originali.

| Issue | Risultato e limite attuale |
| --- | --- |
| [#67](https://github.com/Eun-si123/teamforge-unity-collab/issues/67) | **PASS**: modifica/salvataggio collaborativo legittimo → chiusura Unity Guest → riapertura dello stesso Active Project verificato → riconnessione senza `guest_handoff_mismatch`. Rifiuto identità nuove/non verificate preservato da implementazione rigorosa e regressioni automatiche |
| [#68](https://github.com/Eun-si123/teamforge-unity-collab/issues/68) | **PASS**: Guest nuovo riceve Hierarchy/Transform/Lock autoritativi e Transform successivi senza falso conflitto protetto. Utili altri scenari; blocco originale chiuso |
| [#74](https://github.com/Eun-si123/teamforge-unity-collab/issues/74) | **PASS**: parte perdente della contesa torna allo stato autoritativo; collaborazione utilizzabile. Chiarezza UX con lock altrui separata in #79 |
| [#69](https://github.com/Eun-si123/teamforge-unity-collab/issues/69) | **PASS**: Launcher terminato forzatamente più volte durante ricezione; dati parziali verificati riutilizzati e ripresa completata senza errore CLR/applicazione originale. Conservare regressioni nei futuri cambi Runtime |
| [#70](https://github.com/Eun-si123/teamforge-unity-collab/issues/70) | **PARZIALE PER OBIETTIVO r5 / PASS PER SEED STABILE**: Host Stop/Start riassocia TCP `5091`; trasferimento reale dopo apertura firewall. Configurazione automatica nuova e fallback porta necessitano prove fisiche sul pacchetto sostitutivo esatto |
| [#71](https://github.com/Eun-si123/teamforge-unity-collab/issues/71) | **PASS**: destinazione lunga/profonda attiva ottimizzazione percorso, Unity si apre e collabora. Rifiuto alias malevoli/estranei/reindirizzati resta copertura automatizzata fail-closed |

Le cronologie dettagliate appartengono alle Issues; STATUS ne descrive l'effetto attuale sul rilascio.

## Prove automatiche e locali

Prima del merge di PR #81, il suo head integrato superò le verifiche registrate in `docs/MAIN_PATCH_STATUS_2026-08-27.md`:

- CI #216: Server, Project Peer, loader Runtime Launcher, Windows Launcher e contratto sorgente pubblico **PASS**.
- Dependency Review #140 **PASS**.
- Unity Tests #73: Unity Lock Contention E2E, Unity Realtime Authority E2E, Realtime Authority Chaos E2E e Project Transfer Resume E2E **PASS**.
- Precedente Unity Test Runner locale: **143/143 test eseguibili localmente PASS**; due test con server reale riservati a CI intenzionalmente ignorati in locale.
- Recupero contesa A/B sulla stessa macchina **PASS**; convergenza Hierarchy/Transform A/B/C con ingresso tardivo **PASS**, zero conflitti protetti nel run registrato.

I rafforzamenti successivi hanno test mirati Project Peer/Launcher/Unity e i normali gate del repository. Suite identità Windows superata su Node 22 e 24 supportati; regressione porta Seed indisponibile superata nell'intera suite Project Peer sull'ambiente Windows riprodotto. Questo rafforza la fiducia nel sorgente, non prova i byte pubblicati prima delle correzioni.

## Prove su due PC fisici

Base del 2026-08-22: Host → invito firmato → Guest nuovo → autenticazione → trasferimento diretto → fiducia Publisher → Active verificato → Unity realtime; Presence e Transform bidirezionale; contesa lock normale; creazione/rinomina/reparent/ordine/eliminazione nella stessa Scene. Uscita/rientro Guest senza salvataggio recuperava Hierarchy/Transform/Lock dalla sessione ancora attiva. Interruzione TCP Coordinator → retry → riconnessione automatica senza riavviare Unity.

Il 2026-08-31 l'esatta coppia ZIP/SHA r5 chiuse gli scenari sopra su due PC Windows fisici. Anche Seed `5091` Stop/Start e trasferimento LAN reale passarono; la configurazione iniziale firewall richiedeva ancora autorizzazione manuale.

## Limiti delle prove

Un risultato prova solo ciò che esercita. CI sorgente non prova uno ZIP; automazione Unity non riproduce ogni ordine input SceneView, condizione processi Windows, LAN/firewall o temporizzazione del secondo PC. Test sulla stessa macchina condividono OS, stack rete, tempi e hardware. Prove r5 non provano `main` successivo. La versione non è identità dei byte: servono nome artefatto e SHA-256 esatti. Un bug chiuso non certifica modifiche successive dello stesso sottosistema. Note storiche valgono per il proprio snapshot, senza sostituire lo STATUS attuale.

## Condizioni ancora necessarie per il rilascio

Prima di presentare TeamForge come alpha generalmente installabile:

1. Conservare come concluse le prove r5 di #67/#68/#69/#71/#74.
2. Se si distribuisce `main`, pubblicare un nuovo candidato immutabile.
3. Su quell'artefatto verificare onboarding firewall nuovo, ambito ristretto/ciclo regole, fallback porta preferita occupata/indisponibile, raggiungibilità Seed annunciata, Host Stop/Start e trasferimento Guest nuovo.
4. Verificare recupero identità Windows dopo perdita del processo e rifiuto fail-closed di identità ambigue/in conflitto sull'esatto sostituto.
5. Eseguire smoke test Host appena estratto → Guest nuovo → collaborazione realtime sul sostituto, senza ereditare le prove r5 per supposizione.
6. Registrare nome/SHA/identità sorgente esatti e solo gli scenari eseguiti.
7. Proseguire guide installazione/aggiornamento/disinstallazione e ottenere test/review da persone diverse dal creatore prima di affermazioni generali di affidabilità.

Il riavvio del processo server è **disconnessione/fail-closed/recupero con nuova sessione**, non un test di persistenza: recupero durevole authority/sessione non implementato.

## Fonti responsabili

Capacità/blocchi: [English](STATUS.md); versioni: [contratto](../release-contract.json); byte attuali/superati: [builds](../builds/README.md) e SHA Release; flusso: [Come funziona](HOW_IT_WORKS.it.md); piani: [ROADMAP](ROADMAP.md); struttura: [architecture](architecture.md); motivazioni: [architecture-decisions](architecture-decisions.md); scenari: [TEST_LAB](TEST_LAB.md); bug: Issues; prove precedenti: note datate. I dettagli non tradotti restano in inglese.
