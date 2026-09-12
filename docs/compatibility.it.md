# Compatibilità di TeamForge

Questa pagina descrive i **limiti di compatibilità e topologia per il lettore**.

- Selezioni esatte di prodotto/runtime/protocollo → [`../release-contract.json`](../release-contract.json)
- Validazione e preparazione attuali → [STATUS.md (inglese)](STATUS.md)
- Identità dell'artefatto distribuito → [`../builds/README.md`](../builds/README.md) + SHA-256 esatto della Release

Non duplicare numeri di patch di strumenti/runtime che cambiano spesso: li definisce il contratto di rilascio.

## Prima della prova

Usa un progetto sacrificabile e conserva backup. TeamForge è un'anteprima pubblica iniziale; [STATUS.md](STATUS.md) definisce i limiti delle verifiche sul campo. La matrice distingue piattaforma distribuita e requisiti di sorgente/build.

I requisiti minimi di CPU, RAM, GPU, disco, banda e latenza non sono ancora stati stabiliti con test controllati. Un prototipo funzionante non è una raccomandazione hardware minima.

I Guest devono raggiungere il Server configurato e l'endpoint Project Peer annunciato dall'Host. Un invito firmato non crea raggiungibilità. Usa lo stesso computer, una LAN raggiungibile o una VPN gestita; non sono forniti attraversamento Internet automatico né relay.

## Compatibilità di prodotto e protocollo

I componenti avanzano come una linea compatibile, senza mescolare liberamente versioni Server/Project Peer/Launcher/pacchetto. L'architettura separa:

- autorità di collaborazione in tempo reale sul WebSocket del Server configurato;
- coordinamento dell'avvio e dei metadati del progetto;
- trasferimento diretto dei dati Project Peer;
- integrità del Runtime Host/Guest e del Launcher distribuiti.

L'evoluzione di protocollo/schema è additiva solo se la semantica esistente resta compatibile. I numeri esatti sono in `release-contract.json`. Non mescolare manifesti o binari Runtime/Launcher di candidati diversi solo perché mostrano la stessa versione.

## Compatibilità Unity

La linea supportata è **Unity 6000.3**. Una patch Editor è validata solo con evidenze registrate per il sorgente/candidato previsto; la patch più recente non è automaticamente testata o supportata. L'Editor testato è in `release-contract.json`; le evidenze sono in [STATUS.md](STATUS.md).

## Sviluppatori e runtime

Usa gli intervalli Node/npm/.NET/strumenti del contratto e della configurazione lock/build del repository. Sono **requisiti di sorgente/build**, non normali requisiti d'installazione del percorso Host/Guest distribuito, che usa runtime inclusi/autonomi secondo il contratto. Una nuova famiglia principale di runtime/toolchain richiede una decisione e una validazione deliberate; un'installazione riuscita su un computer non basta.

## Topologia supportata

- WebSocket del Server TeamForge configurato per l'autorità in tempo reale;
- HTTP Project Peer diretto sullo stesso PC, LAN raggiungibile o VPN gestita;
- modalità esplicita stesso-PC, solo loopback;
- ascolto autenticato non-loopback con host concreto annunciato al Guest;
- flusso Windows Host/Guest distribuito con Runtime incluso verificato.

Non sono forniti come topologia supportata: WebRTC / RTCDataChannel; ICE / STUN / TURN; attraversamento NAT automatico; relay/fallback automatico del trasporto; scoperta automatica dei peer; autorità in tempo reale serverless/integrata; distribuzione su Internet pubblico non fidato con un sistema completo di identità/autorizzazione.

`P2P` significa **trasferimento diretto dei dati Project Peer**, non connettività P2P Internet automatica.

## Matrice delle piattaforme

| Superficie | Stato |
| --- | --- |
| Runtime Windows x64 incluso / Guest Launcher | Direzione distribuita attuale; il candidato esatto segue i criteri sul campo di STATUS |
| Unity 6000.3 | Linea Unity attuale |
| Patch Unity registrata | `release-contract.json` e prove STATUS |
| Altre patch Unity 6000.3 | Nuova baseline/validazione prima di dichiararle testate |
| Launcher autonomo macOS/Linux | Nessun candidato equivalente attuale distribuito |
| Docker/Compose | Opzione sorgente/server, non normale Host distribuito né criterio di rilascio attuale |
| Authenticode | Stato di distribuzione/firma in STATUS/documentazione dell'artefatto |

## Archiviazione gestita Windows nel sorgente attuale

Il sorgente attuale richiede una radice gestita locale su unità fissa NTFS/ReFS per il blocco dell'identità del progetto Windows. Radici di rete, indisponibili o non verificate sono rifiutate (fail-closed). È una condizione dell'archiviazione TeamForge, non un requisito generale Unity. Vedi [STATUS.md](STATUS.md) per il confine sorgente/candidato pubblicato e [l'implementazione](../project-peer/src/project-identity-lock.mjs).

## Dichiarazioni e cronologia

I rapporti storici di fasi, attività e test valgono per il sorgente/artefatto registrato. Una versione simile non li rende prove attuali. Per l'identità dei byte usa nome asset Release + SHA-256, non solo versione.
