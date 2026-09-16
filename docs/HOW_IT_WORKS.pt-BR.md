# Como o TeamForge funciona

Esta página explica **o que acontece ao hospedar, entrar, transferir um projeto, editar uma Scene, desconectar ou recuperar uma falha**. É uma explicação guiada, não uma especificação completa do protocolo nem um mapa do código.

Capacidades/bloqueios: [Estado](STATUS.pt-BR.md); topologia e confiança: [architecture](architecture.md); arquivos: [CODEMAP](../CODEMAP.md); motivos: [architecture-decisions](architecture-decisions.md). Referências detalhadas não traduzidas permanecem em inglês. [O original inglês](HOW_IT_WORKS.md) define o significado.

## O modelo em 60 segundos

Há dois caminhos separados de propósito:

- Unity Editor Host/Guest enviam operações em tempo real por WebSocket à Session Authority do Server.
- Host Unity usa Host Project Peer/Seed; Guest Launcher usa Guest Project Peer. Os peers transferem o conteúdo por HTTP direto; Guest Peer entrega o Active verificado ao Guest Unity.
- Server coordena metadados assinados com ambos, sem virar relay de arquivos.
- Guest só abre o conteúdo após verificar confiança, integridade, ativação e entrega ao Unity.

Isso separa transferências grandes do tráfego sensível à latência, mantendo uma única autoridade em tempo real.

## Processos principais

### Pacote Unity Editor

Fornece fluxo Host, ciclo de conexão, Presence, Transform/Lock e Hierarchy na mesma Scene suportados, diagnóstico/recuperação e aplicação do estado remoto aprovado à Scene local. O cliente **observa a autoridade**: um valor local não se torna autoritativo só por existir em um Editor.

### TeamForge Server

**Session Authority** gerencia membros, revisão/ordem compartilhadas, locks/leases, estado Scene suportado retido, proteção replay/idempotência e efeitos em tempo real. **Project Coordinator** coordena metadados assinados projeto/publisher/baseline/peer. Server não armazena nem retransmite o conteúdo normal Manifest/File/Chunk.

### Project Peer

Gerencia validação de convites assinados, manifestos/hashes determinísticos, HTTP direto, retomada verificada, staging, revisões Active imutáveis, segurança de arquivos/caminhos e confiança projeto/publisher. Download bem-sucedido não basta para ativar: toda a cadeia de verificação e confiança deve passar.

### Windows Guest Launcher

Guest novo começa fora do Unity porque talvez ainda não haja projeto. Launcher verifica Runtime incluído, convite e confiança, recebe via Peer, valida Active final e Unity necessário e entrega o projeto ao Unity. Guest empacotado normal não precisa instalar nem operar manualmente Node.js/npm do sistema.

O código Launcher atual também cria um **pacote de suporte local manual**: ZIP de observação limitado e com dados sensíveis removidos. Não há upload automático, concessão de autoridade ou desvio de validação de convite, confiança, ativação, Runtime, caminho ou entrega Unity. Sua presença no pacote depende do artefato exato; [Estado](STATUS.pt-BR.md) e [builds](../builds/README.md) separam código e publicação.

## Quando Host inicia colaboração

1. Seleciona **Publish & Start**.
2. Unity verifica projeto local e pré-requisitos de Scene salva.
3. Peer prepara baseline determinística e identidades de integridade de arquivos/chunks.
4. Host Peer inicia Seed de transferência direta.
5. Coordena metadados projeto/publisher/baseline/peer com Server.
6. Cria Collaboration Invite assinada e fica pronto para Guests.

Existem controles fail-closed adicionais. **Host Ready é mais que uma porta aberta**: contratos de transferência e sessão necessários ao Guest estão estabelecidos. Convite não deve transportar código de acesso, chave privada de assinatura ou caminho local arbitrário. Código de acesso, quando usado, é compartilhado separadamente.

## Quando Guest novo entra

1. Abre Windows Guest Launcher e verifica Runtime incluído.
2. Carrega/cola convite e valida estrutura/assinatura.
3. Examina identidade e confiança Project/Owner/Publisher.
4. Contata Host/Seed coordenado e recebe descriptor/manifest/inventory.
5. Baixa somente chunks necessários; verifica integridade de chunk, arquivo, manifesto e projeto.
6. Monta em staging e verifica candidato completo.
7. Cria revisão Active imutável e move o pequeno ponteiro do projeto atual.
8. Valida executável Unity requerido e entrega final; abre o projeto verificado.

Um diretório parcialmente baixado não vira arbitrariamente o projeto atual. A revisão Active anterior verificada pode continuar disponível durante novo recebimento ou falha de ativação.

### Retomada orientada pela verificação

Após interrupção, conteúdo já verificado pode ser reaproveitado onde o contrato permitir. Não significa confiar em qualquer arquivo no disco: hashes e contrato de ativação continuam mandando.

## Ao editar objeto Scene suportado

1. Usuário move GameObject; serviço Transform observa a mudança.
2. Resolve identidade canônica de autoridade do objeto.
3. Verifica lock/lease e autoridade da conexão; envia operação Transform por WebSocket.
4. Session Authority valida e aplica ordem, revisão e idempotência.
5. Distribui efeito aprovado aos outros clientes.
6. Receptor atualiza Authority View; Unity aplica Transform remoto aprovado com segurança.

**Identidade:** os Editor precisam apontar para o **mesmo objeto lógico**, não apenas nomes ou caminhos Hierarchy iguais. Objetos de Scene salva usam identidade Unity estável; objetos de sessão suportados podem receber identidade TeamForge após vinculação autoritativa. Ambiguidade resulta em fail-closed, não em adivinhação por nome, índice de irmão ou caminho.

**Autoridade:** Server decide o estado compartilhado aceito. Clientes relatam intenção e aplicam resultados, sem verdades independentes concorrentes.

**Revisão/ordem:** operações aceitas avançam a ordem comum. Revisão permite avaliar estado antigo, entradas tardias, replay e se a operação foi analisada contra o estado esperado.

**Lock/lease:** locks controlados pela autoridade evitam sobrescrita simultânea silenciosa. Leases expiram quando cliente desaparece, em vez de virarem locks permanentes.

**Replay/idempotência:** distingue retry legítimo da mesma operação de outra que tenta reutilizar identidade. Entrega duplicada não deve alterar estado duas vezes.

## Alterações Hierarchy

Criar/excluir/renomear/reparentear/ordenar irmãos na mesma Scene usa caminho autoritativo separado, não um Transform disfarçado. Transform depende da estrutura: pais ou identidades diferentes podem produzir Scenes diferentes com os mesmos números locais. Não infira sincronização geral Component/Inspector/Prefab/Asset nem estruturas arbitrárias entre Scenes; veja [Estado](STATUS.pt-BR.md).

## Reconexão e épocas

Reconectar não comprova que a autoridade antiga continua válida. Fluxo: perder conexão, deixar de confiar na autoridade daquela conexão, reconectar/handshake, receber capacidades negociadas e estado atuais, revincular objetos suportados à nova época e retomar apenas quando o estado necessário estiver pronto. Aliases persistidos e identidades em cache ajudam na resolução, mas não concedem autoridade sozinhos.

## Falhas e recuperação

Preserva-se estado verificado em vez de forçar um desconhecido:

- Runtime danificado: parar antes de executar código não verificado;
- convite inválido/conflitante: manter vínculo de projeto existente;
- falha de transferência: preservar progresso verificado reutilizável permitido;
- falha de ativação: não substituir Active anterior verificado;
- problema de caminho Unity: somente estratégia TeamForge validada separadamente;
- baseline/identidade divergente: exigir conciliação/atualização, não adivinhar;
- processo desconhecido na porta necessária: não encerrá-lo só para obter a porta.

A recuperação depende do **estado**. Retry, Paste New Invite, Use Latest Project, Open Existing Verified Project e Choose Unity só aparecem onde têm significado seguro definido.

**Diagnósticos observam; não são autoridade de recuperação.** Copiar diagnóstico ou salvar ZIP manual descreve a execução. Salvar não muda Project, repete operação, confia em Publisher, ativa conteúdo nem relaxa controles. O bundle coleta uma visão segura limitada, não dados amplos de projeto/máquina; ainda deve ser revisado antes de compartilhamento público.

## Por que separar os caminhos?

Colaboração usa melhor mensagens autoritativas pequenas e ordenadas. Bootstrap envolve muitos arquivos, grandes fluxos, retries, resume, hashes, staging e disco. Separar evita gargalo oculto de bytes no Server e esclarece limites de segurança/falha.

A contrapartida é Guest realmente alcançar Host Peer. Isso se ajusta ao mesmo PC, LAN acessível ou VPN gerenciada. Descoberta Internet/NAT/relay automáticos são outro problema futuro de transporte, não promessa implícita de P2P.

## Onde o estado vive

| Estado | Duração/responsável |
| --- | --- |
| Session Authority | Memória Server da sessão ativa |
| Registro de coordenação | Memória Server |
| Client Authority View | Conexão Unity atual |
| Conteúdo de transferência/staging | Armazenamento gerenciado Project Peer |
| Revisões Active verificadas | Armazenamento de projeto gerenciado durável |
| Ponteiro Active atual | Metadados pequenos persistentes |
| Histórico diagnóstico Launcher | Limitado à execução atual |
| Support bundle manual | ZIP local criado pelo usuário, limitado/expurgado; sem upload automático |

Projeto baixado durável não implica histórico durável de autoridade, e diagnóstico salvo não vira autoridade. Isso importa em reinício, reconexão, retomada e recuperação.

## Seguir o comportamento no código

[CODEMAP](../CODEMAP.md) mantém arquivos/testes exatos para esta explicação continuar útil após refatorações. Caminhos típicos: conexão → Unity `TeamForgeConnectionService` + host WebSocket Server; Transform/Lock → serviço Transform + Authority View + Session Authority; Hierarchy → serviço Unity + modelo Server/Session Authority; transferência → orquestradores Peer Host/Guest + fonte direta + content store; início/recuperação Guest → Windows Launcher + Launcher Core + orquestrador Guest; suporte → UI diagnóstico + bundle/remoção de dados sensíveis Core; resiliência de caminhos → Launcher Core + contrato compartilhado Project Peer.
