# Come funziona TeamForge

Questa pagina spiega **cosa accade quando si ospita, si entra, si trasferisce un progetto, si modifica una Scene, ci si disconnette o si recupera da un errore**. È una spiegazione guidata, non una specifica completa del protocollo o una mappa del codice.

Capacità/blocchi: [Stato](STATUS.it.md); topologia e confini di fiducia: [architecture](architecture.md); file: [CODEMAP](../CODEMAP.md); motivazioni: [architecture-decisions](architecture-decisions.md). I dettagli non tradotti restano in inglese. L'[English](HOW_IT_WORKS.md) è il riferimento semantico.

## Il modello in 60 secondi

Due percorsi dati intenzionalmente separati:

- Host e Guest Unity Editor inviano operazioni realtime via WebSocket alla Session Authority del Server.
- Host Unity usa Host Project Peer/Seed; Guest Launcher usa Guest Project Peer. I Peer trasferiscono direttamente il payload del progetto via HTTP, poi il Guest Peer consegna un Active verificato a Guest Unity.
- Il Server coordina metadati firmati con entrambi, senza diventare relay dei file di progetto.
- Guest apre contenuti solo dopo verifiche di fiducia, integrità, attivazione e passaggio a Unity.

I trasferimenti grandi restano separati dal traffico sensibile alla latenza, con una sola autorità realtime chiara.

## Processi principali

### Pacchetto Unity Editor

Gestisce Host, ciclo connessione, Presence, Transform/Lock supportati e Hierarchy nella stessa Scene, diagnostica/recupero e applicazione dello stato remoto approvato. Il client **osserva l'autorità**: un valore locale non diventa autoritativo solo perché esiste in un Editor.

### TeamForge Server

**Session Authority**: appartenenza, revisione/ordine condivisi, lock/lease, stato Scene supportato conservato, protezioni replay/idempotenza ed effetti realtime. **Project Coordinator**: metadati firmati progetto/Publisher/baseline/Peer. Il Server non conserva né inoltra il normale payload Manifest/File/Chunk.

### Project Peer

Possiede validazione inviti firmati, manifest/hash deterministici, HTTP diretto, ripresa verificata, staging, revisioni Active immutabili, sicurezza filesystem/percorsi e fiducia Project/Publisher. Il download riuscito non basta: deve passare l'intera catena di verifica e fiducia prima dell'attivazione.

### Windows Guest Launcher

Un Guest nuovo parte fuori Unity, perché potrebbe non avere ancora un progetto. Launcher verifica il Runtime incluso, invito/fiducia, riceve tramite Peer, verifica Active finale e versione Unity richiesta, poi passa a Unity. Un normale Guest del pacchetto non deve installare o gestire manualmente Node.js/npm di sistema.

Il sorgente Launcher può creare un **support bundle locale manuale**: ZIP osservativo limitato e con dati sensibili oscurati, senza upload automatico, concessione di autorità o bypass di invito, fiducia, attivazione, Runtime, percorsi o passaggio Unity. La presenza nel pacchetto dipende dall'artefatto esatto; [Stato](STATUS.it.md) e [builds](../builds/README.md) distinguono sorgente e pacchetti.

## Host avvia la collaborazione

1. Sceglie **Publish & Start**.
2. Unity verifica progetto locale e prerequisiti Scene salvata.
3. Peer prepara baseline deterministica e identità d'integrità per file/chunk.
4. Host Peer avvia il Seed di trasferimento diretto.
5. Coordina metadati Project/Publisher/baseline/Peer con Server.
6. Crea una Collaboration Invite firmata; Host pronto ai Guest.

Esistono ulteriori verifiche fail-closed. **Host Ready significa più di una porta aperta**: sono stabiliti i contratti di trasferimento e sessione necessari al Guest. L'invito non è destinato a contenere codice d'accesso, chiave privata di firma o percorso locale arbitrario. L'eventuale codice d'accesso si condivide separatamente.

## Ingresso di un Guest nuovo

1. Aprire Windows Guest Launcher e verificare Runtime incluso.
2. Caricare/incollare invito; verificarne struttura e firma.
3. Controllare identità e fiducia Project/Owner/Publisher.
4. Contattare Host/Seed coordinato; ricevere descriptor/manifest/inventory.
5. Scaricare solo i chunk necessari; verificare integrità di chunk, file, manifest e progetto.
6. Costruire nello staging e verificare il candidato completo.
7. Creare revisione Active immutabile; spostare il piccolo puntatore al progetto corrente.
8. Verificare eseguibile Unity richiesto e passaggio finale; aprire il progetto verificato.

Una directory parzialmente scaricata non diventa il progetto corrente. L'Active precedente verificato può restare disponibile durante ricezione o fallimento dell'attivazione.

### Ripresa consapevole della verifica

Si riutilizzano solo contenuti già verificati dove il contratto lo permette. Non significa fidarsi di qualunque file sul disco: hash e contratto d'attivazione restano vincolanti.

## Modifica di un oggetto Scene supportato

1. Utente muove GameObject; servizio Transform Unity rileva la modifica.
2. Risolve l'identità canonica dell'oggetto per l'autorità.
3. Controlla lock/lease e autorità della connessione; invia operazione Transform via WebSocket.
4. Server valida e applica ordine/revisione/idempotenza.
5. Trasmette l'effetto approvato agli altri client.
6. Il ricevente aggiorna Authority View; Unity applica in sicurezza il Transform remoto approvato.

**Identità:** gli Editor devono riferirsi allo stesso oggetto logico, non solo stesso nome/percorso Hierarchy. Oggetti Scene salvati usano identità Unity stabile; oggetti supportati creati in sessione possono ricevere identità TeamForge dopo binding autoritativo. Ambiguità → fail-closed, senza indovinare da nome, indice sibling o percorso.

**Autorità:** il Server decide lo stato realtime comune accettato; i client inviano intenzioni e applicano risultati, senza verità concorrenti.

**Revisione/ordine:** le operazioni accettate avanzano l'ordine condiviso. Revisioni permettono di valutare obsolescenza, ingressi tardivi, replay e verifica rispetto allo stato atteso.

**Lock/lease:** controllati dall'autorità, impediscono sovrascritture simultanee silenziose. I lease scadono se un client scompare, senza diventare lock permanenti.

**Replay/idempotenza:** retry legittimo della stessa operazione è distinto da altra operazione che riusa un'identità; doppia consegna non deve modificare due volte lo stato.

## Modifiche Hierarchy

Creazione/eliminazione/rinomina/reparent/ordine sibling nella stessa Scene hanno un percorso autoritativo separato da Transform. Transform dipende dalla struttura: parent/identità diversi possono produrre Scene diverse con gli stessi numeri locali. Non implica sincronizzazione generale Component/Inspector/Prefab/Asset né strutture arbitrarie tra Scene; vedere [Stato](STATUS.it.md).

## Riconnessione ed epoche

Riconnettersi non prova la validità della vecchia autorità: perdita connessione → cessare fiducia nell'autorità della connessione → reconnect/handshake → capacità negoziate e stato autoritativo attuali → nuovo binding degli oggetti supportati per la nuova epoca → riprendere solo quando lo stato richiesto è pronto. Alias persistiti/cache identità possono aiutare la risoluzione, senza concedere autorità da soli.

## Errori e recupero

Preservare lo stato verificato invece di forzare uno stato sconosciuto:

- Runtime danneggiato: fermarsi prima di eseguire codice non verificato;
- invito invalido/in conflitto: non cambiare il binding Project;
- trasferimento fallito: conservare progresso verificato riutilizzabile consentito;
- attivazione fallita: non sostituire Active precedente verificato;
- percorso Unity problematico: solo strategia TeamForge separatamente validata;
- baseline/identità discordanti: richiedere riconciliazione/aggiornamento, non indovinare;
- processo sconosciuto sulla porta richiesta: non terminarlo perché TeamForge vuole la porta.

Azioni **dipendenti dallo stato**: Retry, Paste New Invite, Use Latest Project, Open Existing Verified Project, Choose Unity compaiono solo dove hanno significato sicuro definito.

**Diagnostica è osservazione, non autorità di recupero.** Copia diagnostica e bundle manuale descrivono il run. Salvarlo non seleziona Project, ritenta operazioni, concede fiducia Publisher, attiva contenuti o allenta controlli. Raccoglie una vista sicura limitata, non dati estesi del progetto/macchina; controllarlo comunque prima della condivisione pubblica.

## Perché separare trasferimento e realtime

Realtime richiede messaggi autoritativi piccoli e ordinati. Bootstrap implica molti file, flussi grandi, retry, ripresa, hash, staging e disco. Separarli evita un collo di bottiglia nascosto nel Server e chiarisce confini di sicurezza/errore.

Il prezzo è la reale raggiungibilità dell'Host Peer dal Guest: stesso PC, LAN raggiungibile o VPN gestita. Discovery Internet/NAT traversal/relay automatici sono lavoro di trasporto futuro separato, non promesse implicite di P2P.

## Dove vive lo stato

| Stato | Durata/proprietario |
| --- | --- |
| Session Authority realtime | Memoria Server della sessione attiva |
| Registro coordinamento Project | Memoria Server |
| Authority View client | Connessione Unity corrente |
| Contenuto trasferimento/staging | Storage gestito Project Peer |
| Revisioni Active verificate | Storage Project gestito durevole |
| Puntatore Active corrente | Piccoli metadati durevoli |
| Cronologia diagnostica Launcher | Limitata al run corrente |
| Support bundle manuale | ZIP locale limitato/oscurato creato dall'utente; nessun upload automatico |

Un progetto scaricato durevole non implica cronologia authority durevole; un artefatto diagnostico non diventa autorità. Distinzione essenziale per riavvio, riconnessione, ripresa e recupero.

## Dal comportamento al codice

[CODEMAP](../CODEMAP.md) mantiene file/test esatti. Percorsi tipici: connessione → Unity `TeamForgeConnectionService` + host WebSocket Server; Transform/Lock → servizio Transform + Authority View + Session Authority; Hierarchy → servizio Unity + modello Server/Session Authority; bootstrap/transfer → orchestratori Host/Guest Peer + fonte diretta + content store; avvio/recupero Guest → Windows Launcher + Launcher Core + orchestratore Guest; supporto → UI diagnostica + bundle/redazione Core; resilienza percorsi → Launcher Core + contratto condiviso Project Peer. Non duplicare qui nomi di file volatili: la spiegazione deve resistere ai refactoring.
