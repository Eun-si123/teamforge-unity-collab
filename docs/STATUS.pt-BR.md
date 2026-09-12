# Estado atual do TeamForge

[English](STATUS.md) · [Como funciona](HOW_IT_WORKS.pt-BR.md)

_Revisão documental do original: 2026-09-10 UTC. Concilia o código main posterior ao r5 (rede Windows, diagnósticos e identidade de projeto), o artefato r5 publicado e seus resultados físicos exatos de 2026-08-31. Evidências do pacote e do código mais novo continuam separadas._

> **Prévia pública inicial: não use o TeamForge como única cópia ou mecanismo de recuperação de um projeto Unity importante.** Os bloqueios Windows WP5.1 originais receberam validação física substancial no r5 exato. main é mais novo e contém mudanças de rede/identidade ainda não validadas juntas em um pacote substituto exato em PCs físicos. Mantenha backups e prefira projetos descartáveis.

[STATUS em inglês](STATUS.md) é a fonte humana canônica das capacidades e da prontidão de lançamento. Outros documentos devem apontar para ela, sem manter listas concorrentes de bloqueios. Seleções exatas: [release-contract.json](../release-contract.json); identidade dos bytes e regras de builds substituídos: [builds/README.md](../builds/README.md); bugs e reproduções históricas: Issues do GitHub.

## Visão geral

- Linha do produto: `0.5.1`; linhagem do código: `0.5.1-wp5.1-path-resilience`.
- Candidato empacotado publicado mais recente: `v0.5.1-prealpha-wp5.1-r5`.
- Commit de origem/tag r5: `a97b6ba5649e2888b909bf3c99c64acfd7042ba6`.
- ZIP: `Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r5-win-x64.zip`.
- SHA-256: `5944abf2263502ee40f49d0ac2c8a9826a809dc4cd1b20c9edf82f94ba35f8cc`.
- Destino do pacote: Windows x64; prontidão: **FIELD BLOCKED**, condições de campo ainda pendentes.
- Unity: `6000.3`; Editor registrado para testar o candidato: `6000.3.21f1`.
- Realtime Protocol, Project Transfer Protocol e Project Manifest Schema: **v1** cada.

## Código versus candidato publicado

As correções WP5.1 originais para #67, #68/#74, #69, #70 e #71 foram integradas até o PR #81. r5 veio do commit indicado e inclui essas correções e a integração **Save support bundle** do Launcher posterior ao r4.

Em 2026-08-31, o r5 exato foi exercitado em dois PCs Windows físicos: reconexão de Guest salvo, snapshot Transform de novo participante tardio, encerramento/retomada repetidos durante recebimento, entrega por execution alias em caminhos longos/profundos e recuperação de conflito protegido por contenção de lock antigo. Após liberar o firewall necessário, também passaram Host Stop/Start com nova vinculação ao Seed TCP `5091` e transferência real ao Guest.

Esses cenários não aguardam mais sua primeira repetição física no r5. Isso não coloca mudanças posteriores dentro do r5 nem torna o produto uma alpha instalável de forma geral. Alegações sobre o pacote se limitam ao r5 e às provas de 2026-08-31; ele não equivale em bytes/comportamento ao main. Listas antigas não devem tratar os cenários encerrados como pendentes. Distribuir main exige novo artefato imutável e validação nele do que foi adicionado após r5.

## Reforços posteriores ausentes do r5

- Configuração LAN do firewall Windows: após aprovação explícita do usuário e UAC, pode criar regras de entrada restritas Coordinator/Seed no perfil Private e LocalSubnet, com conciliação/limpeza das regras pertencentes ao TeamForge. r5 exigiu permissão manual; o novo fluxo precisa de prova física do pacote exato.
- Porta Seed preferida/padrão ocupada ou indisponível, incluindo `EACCES` no contexto de bind Windows: Host tenta uma vez com porta atribuída pelo SO e anuncia o endpoint escolhido. Há cobertura automática Windows Project Peer; é comportamento pós-r5.
- Criação serializada de identidade de projeto e recuperação de falha Windows por lock vivo named-pipe pertencente ao SO e barreira permanente de compatibilidade para writers antigos. Suites Windows Node 22/24 de falha/concorrência passaram; nenhum pacote publicado com a mudança recebeu prova física exata.
- Limpeza de rejeições Coordinator, cancelamento/prazos HTTP, contexto diagnóstico Host, logs de papel do cliente WebSocket e distinção de convites Launcher e códigos `TF1`.

São fatos de código/automação, não do pacote r5. Recuperação de lock antigo de identidade em Linux/macOS fica fora da mudança específica Windows.

## Capacidades

| Área | Estado do código | Limite da evidência |
| --- | --- | --- |
| Presença dos usuários | Implementada/exercitada | Base física de dois PCs funcionou; testes externos mais amplos úteis |
| Seleção/contexto Editor | Implementados/exercitados | Testes externos mais amplos úteis |
| Transform | Implementado/em estabilização | r5 entrada tardia e recuperação de contenção PASS; cobertura de campo e UX a ampliar |
| Locks/propriedade básicos | Implementados/em estabilização | r5 contenção/recuperação PASS; UX de edição sob lock alheio em #79 |
| Hierarchy na mesma Scene: criar/excluir/renomear/reparentear/ordenar | Implementada/em estabilização | Subconjunto exercitado fisicamente; ampliar cobertura é útil |
| Bootstrap/Collaboration Invite | Implementados/em estabilização | Guest salvo r5 PASS; recuperação de identidade posterior sem prova pacote/campo |
| P2P direto | Implementado/em estabilização | r5 `5091` Stop/Start e transferência PASS; novos firewall/fallback sem prova do substituto |
| Diagnósticos/UX de recuperação | Implementados/em estabilização | r5 inclui pacote de suporte com proteção de privacidade; melhorias posteriores só no código |
| Resiliência de caminhos Windows/execution alias | Implementada/em estabilização | Entrega longa/profunda r5 PASS; rejeição de alias malicioso/alheio automatizada fail-closed |
| Component/Inspector | Planejados | Sem adição/remoção geral de Component nem sincronização SerializedProperty |
| Prefab/Asset geral | Planejados | Não é fluxo atual suportado |
| Recuperação persistente após reinício servidor/sessão | Planejada | Autoridade/sessão ficam em memória |
| NAT Internet/relay automáticos | Pesquisa/futuro | Sem WebRTC, ICE, STUN, TURN, relay, descoberta ou travessia NAT automática |

## Encerramentos físicos do r5 exato

A tabela substitui textos antigos que ainda tratavam esses bloqueios como aguardando validação física.

| Issue | Resultado e limite atual |
| --- | --- |
| [#67](https://github.com/Eun-si123/teamforge-unity-collab/issues/67) | **PASS**: edição/salvamento legítimos, fechar Unity Guest, reabrir o mesmo Active verificado e reconectar sem `guest_handoff_mismatch`. Rejeição de identidade nova/não verificada protegida por implementação estrita e regressões automáticas |
| [#68](https://github.com/Eun-si123/teamforge-unity-collab/issues/68) | **PASS**: Guest novo recebeu Hierarchy/Transform/Lock autoritativos e Transform posterior sem falso conflito protegido. Mais cenários úteis; bloqueio original encerrado |
| [#74](https://github.com/Eun-si123/teamforge-unity-collab/issues/74) | **PASS**: lado perdedor da contenção voltou ao estado autoritativo e a colaboração permaneceu utilizável. UX de lock alheio separada em #79 |
| [#69](https://github.com/Eun-si123/teamforge-unity-collab/issues/69) | **PASS**: Launcher encerrado à força várias vezes durante recebimento; reutilização de partes verificadas e retomada concluída sem o erro CLR/aplicação original. Preservar regressões em futuras mudanças runtime |
| [#70](https://github.com/Eun-si123/teamforge-unity-collab/issues/70) | **PARCIAL PARA META r5 / PASS PARA SEED ESTÁVEL**: Host Stop/Start voltou a vincular TCP `5091` e houve transferência real com firewall liberado. Configuração automática e fallback posteriores exigem prova física no pacote substituto exato |
| [#71](https://github.com/Eun-si123/teamforge-unity-collab/issues/71) | **PASS**: destino longo/profundo acionou otimização, Unity abriu e colaboração funcionou. Recusa de alias malicioso/alheio/redirecionado permanece cobertura automática fail-closed |

Cronologia detalhada pertence às Issues; o efeito atual no lançamento pertence ao STATUS.

## Evidência automática e local

Antes do merge de PR #81, o head integrado passou nas proteções registradas em `docs/MAIN_PATCH_STATUS_2026-08-27.md`:

- CI #216: Server, Project Peer, carregador runtime Launcher, Windows Launcher e contrato de fonte pública **PASS**.
- Dependency Review #140 **PASS**.
- Unity Tests #73: Lock Contention E2E, Realtime Authority E2E, Realtime Authority Chaos E2E, Project Transfer Resume E2E **PASS**.
- Unity Test Runner local anterior: **143/143 executáveis localmente PASS**; dois testes com servidor real exclusivos de CI ignorados localmente de propósito.
- Recuperação de contenção A/B na mesma máquina **PASS**; convergência Hierarchy/Transform A/B/C com entrada tardia **PASS**, zero conflitos protegidos na execução registrada.

Mudanças posteriores tiveram testes focados Project Peer/Launcher/Unity e controles normais. A suite de identidade Windows passou nas linhas Node 22/24 suportadas; a regressão da porta Seed indisponível passou na suite completa Project Peer no Windows reproduzido. Isso reforça confiança no código, sem provar bytes publicados antes da correção.

## Provas físicas de dois PCs

Base de 2026-08-22: Host→convite assinado→Guest novo→autenticação→transferência direta→confiança Publisher→Active verificado→conexão Unity; Presence/Transform bidirecional; contenção normal; criar/renomear/reparentear/ordenar irmãos/excluir na mesma Scene. Saída/reabertura Guest sem salvar recuperou Hierarchy/Transform/Lock da sessão ainda ativa. Interrupção TCP Coordinator levou a retry/reconexão automática sem reiniciar Unity.

Em 2026-08-31, o par ZIP/SHA exato r5 encerrou em dois PCs os cenários de reconexão salva, entrada tardia, recebimento/retomada repetidos, caminhos longos e contenção. Seed `5091` Stop/Start e LAN real também passaram; a liberação inicial do firewall ainda era manual.

## Limites de evidência

O resultado prova só o exercitado. CI de código não prova um ZIP. Automação Unity não reproduz toda ordem de entrada SceneView, condição de processo Windows, LAN/firewall ou tempo do segundo PC. Testes na mesma máquina compartilham SO, pilha de rede, ambiente temporal e hardware. r5 físico não prova main posterior. Versão não é identidade de bytes: requer nome exato/SHA-256. Bug fechado não valida fisicamente toda alteração posterior do subsistema. Registros históricos valem para seus snapshots, sem substituir STATUS atual.

## Condições restantes antes de uma alpha geral

1. Preservar os encerramentos r5 #67/#68/#69/#71/#74 como concluídos.
2. Publicar novo candidato imutável se main for distribuído.
3. No artefato exato, validar firewall novo, escopo/ciclo restritos das regras, fallback de porta preferida ocupada/indisponível, acesso real ao Seed anunciado, Host Stop/Start e transferência Guest nova.
4. Validar recuperação Windows de identidade após perda do processo e manutenção de fail-closed para identidades ambíguas/conflitantes.
5. Smoke com extração nova Host→Guest novo→colaboração no substituto, sem herdar provas r5 por suposição.
6. Registrar nome/SHA/identidade de fonte exatos e somente cenários realmente executados.
7. Avançar guias de instalação/atualização/desinstalação e obter testes/revisão de pessoas além do criador antes de alegações amplas de confiabilidade.

Reiniciar o servidor é **desconexão/fail-closed/recuperação com nova sessão**, não teste de persistência: recuperação durável de autoridade/sessão não está implementada.

## Fontes responsáveis

Capacidades/bloqueios: [STATUS inglês](STATUS.md); versões: [contrato](../release-contract.json); bytes atuais/substituídos: [builds](../builds/README.md) + SHA Release; fluxo: [Como funciona](HOW_IT_WORKS.pt-BR.md); planos: [ROADMAP](ROADMAP.md); estrutura: [architecture](architecture.md); motivos: [architecture-decisions](architecture-decisions.md); cenários: [TEST_LAB](TEST_LAB.md); bugs: Issues; testes antigos: notas datadas. Documentos detalhados não traduzidos continuam em inglês.
