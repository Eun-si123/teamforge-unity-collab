# Compatibilidade do TeamForge

Esta página descreve **os limites de compatibilidade e topologia para quem usa o projeto**.

- Seleções exatas atuais de produto, runtime e protocolo → [`../release-contract.json`](../release-contract.json)
- Validação e prontidão atuais → [STATUS.md](STATUS.md)
- Identidade do artefato empacotado → [`../builds/README.md`](../builds/README.md) + SHA-256 exato da Release

Evite copiar números de patch de ferramentas ou runtimes que mudam com frequência para vários documentos. O contrato de versão mantém essas seleções exatas.

## Antes de testar

Use um projeto descartável e mantenha backups: o TeamForge é uma prévia pública inicial, e [STATUS.md](STATUS.md) mantém os limites atuais de validação em campo. A tabela de plataformas separa o destino do pacote dos requisitos de código-fonte e compilação.

Os requisitos mínimos de CPU, RAM, GPU, disco, largura de banda e latência ainda não foram estabelecidos por testes controlados. Uma execução bem-sucedida do protótipo não é uma recomendação de hardware mínimo.

Os Guest precisam conseguir acessar o Server configurado e o endpoint do Project Peer anunciado pelo Host. Um convite assinado não cria conectividade de rede. Use a mesma máquina, uma LAN acessível ou uma VPN gerenciada; não há travessia automática da internet nem relay.

## Compatibilidade de produto e protocolo

Os componentes do TeamForge devem evoluir como uma única linha de produto compatível, em vez de misturar de forma independente as versões de Server, Project Peer, Launcher e do pacote.

A arquitetura atual separa:

- autoridade de colaboração em tempo real pelo WebSocket do TeamForge Server configurado;
- preparação inicial do projeto e coordenação de metadados;
- transferência direta de dados do Project Peer;
- integridade do Runtime Host/Guest e do Launcher empacotados.

A compatibilidade entre versões de protocolo ou esquema só é aditiva quando a semântica existente permanece compatível. Os números exatos selecionados pertencem ao `release-contract.json`.

Não misture manifestos gerados de Runtime/Launcher ou binários de candidatos empacotados diferentes só porque exibem a mesma versão do produto.

## Compatibilidade com Unity

A linha de produto Unity atualmente suportada é **Unity 6000.3**.

Um patch específico do Editor só pode ser considerado validado quando há evidências registradas para o código ou candidato pretendido. Não trate o patch mais recente do Unity como automaticamente testado ou suportado.

A seleção exata do Editor registrada nos testes fica em `release-contract.json`, e as evidências atuais estão resumidas em [STATUS.md](STATUS.md).

## Compatibilidade de desenvolvimento e runtime

Quem desenvolve a partir do código-fonte deve usar as faixas de Node/npm/.NET/ferramentas selecionadas por `release-contract.json` e pela configuração de lock e compilação do repositório.

Esses são **requisitos de código-fonte e compilação**, não os requisitos normais de instalação para usuários finais do fluxo Host/Guest empacotado, que usa componentes de runtime incluídos ou autocontidos conforme o contrato de versão atual.

Uma nova família de versões principais de Runtime ou ferramentas deve passar por uma decisão explícita de compatibilidade e validação. Isso não deve ser deduzido de uma instalação bem-sucedida em uma única máquina.

## Topologia suportada

A topologia atualmente suportada ou pretendida inclui:

- WebSocket do TeamForge Server configurado para autoridade em tempo real;
- transferência HTTP direta do Project Peer no mesmo PC, em LAN acessível ou VPN gerenciada;
- modo explícito no mesmo PC restrito a loopback;
- escuta autenticada fora de loopback com um host concreto anunciado ao Guest;
- fluxo Windows Host/Guest empacotado usando Runtime incluído e verificado.

Não são fornecidos atualmente como topologia suportada:

- WebRTC / RTCDataChannel;
- ICE / STUN / TURN;
- travessia automática de NAT;
- relay / troca automática de transporte em caso de falha;
- descoberta automática de peers;
- autoridade em tempo real sem servidor ou embutida;
- implantação na internet pública não confiável com um sistema completo de identidade de usuários e autorização.

Na documentação atual do TeamForge, `P2P` significa **transferência direta de dados do Project Peer**, não conectividade P2P automática pela internet.

## Tabela de plataformas

| Área | Status de compatibilidade |
| --- | --- |
| Runtime incluído Windows x64 / Guest Launcher | Direção atual da plataforma empacotada; o candidato exato ainda segue os critérios de validação em campo de STATUS |
| Unity 6000.3 | Linha atual do Unity |
| Patch exato do Unity registrado | Consulte `release-contract.json` + evidências em STATUS |
| Outros patches do Unity 6000.3 | Exigem nova base de referência e validação separada antes de serem declarados testados |
| Launcher independente para macOS/Linux | Não empacotado como candidato atual equivalente |
| Docker/Compose | Opção de código-fonte ou servidor, não o fluxo Host empacotado normal nem um critério atual de lançamento |
| Authenticode | O status de distribuição e assinatura pertence a STATUS e à documentação do artefato atual |

## Armazenamento gerenciado do Windows no código atual

O código atual exige uma raiz gerenciada local fixa NTFS/ReFS para o bloqueio de identidade do projeto no Windows. Raízes de rede, indisponíveis ou não verificadas são recusadas. É uma condição do armazenamento gerenciado do TeamForge, não um novo requisito geral de projetos Unity. Veja [STATUS.md](STATUS.md) para a distinção entre código-fonte e candidato publicado e a [implementação responsável](../project-peer/src/project-identity-lock.mjs).

## Afirmações de compatibilidade e histórico

Relatórios históricos de fases, trabalho e testes se aplicam ao código ou artefato que registraram. Não devem ser usados como evidência atual de compatibilidade só porque a versão exibida se parece com a linha atual.

Quando a identidade exata dos bytes importar, use o nome do arquivo da Release + SHA-256, não apenas a versão do produto.
