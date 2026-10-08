# Status atual do TeamForge

[English](STATUS.md) · [Como funciona](HOW_IT_WORKS.pt-BR.md)

_Esta tradução de prévia foi comparada com o `STATUS.md` canônico em inglês de 2026-10-08. Para evidências detalhadas, Issues e decisões atuais, a versão em inglês é a referência._

> **Prévia pública inicial: não use o TeamForge como única cópia ou único mecanismo de recuperação de um Unity Project importante.** Mantenha backups e prefira Projects de teste descartáveis.

## Resumo atual

- Linha do produto: `0.5.1`
- Source lineage: `0.5.1-wp5.1-path-resilience`
- Candidato publicado mais recente: `v0.5.1-prealpha-wp5.1-r7`
- Source commit do r7: `d88ca4c41ecf1f9cc7aa5d349960f407f158ce9a`
- ZIP Windows: `Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r7-win-x64.zip`
- SHA-256: `a710acd3cd7189c3f44ae1b4ee46a15239313c850ad7f6982e3a58f2492a13aa`
- Alvo: Windows x64
- Prontidão de release: **FIELD BLOCKED**
- Linha Unity: `6000.3` (Editor de teste registrado: `6000.3.21f1`)
- Realtime / Project Transfer / Project Manifest: **v1**

## Limite de evidência do r7

O r7 foi publicado em 2026-10-03 a partir do commit acima e depois passou na **Exact Release Validation** do Windows. A automação baixou novamente o ZIP do Release, verificou o SHA-256 e todos os hashes do release manifest, fez uma extração nova em caminho com caracteres coreanos e espaços a partir de outro diretório de trabalho e validou Runtime/Node empacotado, comportamento fail-closed do Launcher, Windows path resilience e junctions reais.

Isso é **evidência automatizada do pacote exato**. Em um teste físico posterior com Host r6 e Guest r7 exato, o Guest reutilizou o managed root existente sem `destination_contains_unmanaged_content`; depois de alterar o perfil da LAN confiável do Host de Public para Private, o fluxo avançou por Publisher trust, Project receive e abertura do Unity até uma conexão do TeamForge relatada pelo usuário. Ainda não comprova r7 exato nos dois PCs, onboarding UAC novo sem elevação, fallback da porta Seed nem recuperação física de Project identity após perda anormal do processo. Por isso permanece FIELD BLOCKED.

A evidência física do r5 de 2026-08-31 continua válida para os cenários realmente executados: reconnect, late join, receive/resume, long path, lock contention e Seed `5091`/transferência. Publicar r7 não altera os bytes nem os resultados históricos do r5.

## Bloqueios posteriores de r7-on-Host e correções não integradas

Testes físicos posteriores revelaram `baseline_unavailable` mesmo com o Host mostrando Ready sem um Direct Project Peer disponível, uma `DirectoryNotFoundException` de caminho longo ao abrir um Project verificado existente. A revisão do Source também identificou o risco de UUIDs aninhados ao selecionar a pasta de um Project como Projects root.

Desde 2026-10-08, a PR #209 foi integrada à `main`. As correções agora estão no código-fonte, mas **não** no ZIP r7 publicado. CI, Unity Tests e Engineering Quality Gate da PR atualizada passaram; ainda é necessário um novo candidato imutável com validação exact-release e testes físicos. O PASS misto r6/r7 anterior continua válido apenas para seu escopo original; o status permanece **FIELD BLOCKED**.

[PR #209](https://github.com/Eun-si123/teamforge-unity-collab/pull/209) · [English evidence/status](https://eun-si123.github.io/teamforge-unity-collab/status/#later-r7-on-host-blockers-and-pending-source-fixes)

## Escopo atual

Presence, Selection, sincronização Transform, lock/ownership básico, operações Same-Scene Hierarchy suportadas, Project transfer P2P direto, UX de diagnóstico/recuperação e Windows path resilience estão implementados ou em estabilização. O r7 também inclui Windows firewall onboarding pós-r5, fallback de Seed port ocupado/indisponível, Windows Project identity crash recovery, diagnósticos adicionais e feedback SceneView `TeamForge · Locked by <owner>`.

Sincronização Component/Inspector geral, Prefab/Asset geral, recuperação persistente após restart de server/session e NAT traversal/relay automático de Internet ainda não são recursos suportados.

## Validação física restante

1. Extrair o **r7 exato** em dois PCs Windows limpos e testar Firewall onboarding/UAC, regras estreitas em Private + `LocalSubnet` e seu lifecycle.
2. Forçar indisponibilidade/conflito da Seed port preferida; confirmar que o endpoint anunciado após fallback é realmente alcançável, além de Host Stop/Start e Fresh Guest transfer.
3. Simular perda anormal do processo durante Project identity e confirmar recovery segura, mantendo fail closed para identidades ambíguas/conflitantes.
4. Executar Fresh Host → Fresh Guest → Unity realtime smoke e confirmar que o feedback de foreign lock é claro e desaparece após release/takeover.
5. Manter #182 como observação de CI intermitente sem escondê-la com retry/skip; #79 continua como follow-up de UX para movimento SceneView transitório.

## Fontes canônicas

Detalhes de capacidades, blockers e evidências: [English STATUS](STATUS.md); seleções exatas: [`release-contract.json`](../release-contract.json); identidade dos bytes publicados: [`builds/README.md`](../builds/README.md) e SHA-256 do GitHub Release.
