# Estado actual de TeamForge

[English](STATUS.md) · [Cómo funciona](HOW_IT_WORKS.es.md)

_Revisión documental del original: 2026-09-10 UTC. Concilia el código main posterior a r5 —red Windows, diagnósticos e identidad de proyecto—, el artefacto r5 publicado y sus pruebas físicas exactas del 2026-08-31. La evidencia del paquete y la del código posterior siguen separadas._

> **Versión preliminar pública inicial: no uses TeamForge como única copia o mecanismo de recuperación de un proyecto Unity importante.** Los bloqueos originales WP5.1 de Windows recibieron amplia validación física con r5 exacto. main es posterior e incluye cambios de red/identidad que aún no se han validado juntos como un paquete de reemplazo exacto en PC físicos. Conserva copias de seguridad y prefiere proyectos desechables.

[STATUS en inglés](STATUS.md) es la fuente humana canónica de capacidades y preparación para publicar. Los demás documentos deben enlazarla, no mantener un estado rival de bloqueos. Las selecciones exactas están en [release-contract.json](../release-contract.json); la identidad de bytes y reglas de paquetes sustituidos en [builds/README.md](../builds/README.md); los detalles y reproducciones históricas en Issues.

## Resumen actual

- Línea: `0.5.1`; linaje del código: `0.5.1-wp5.1-path-resilience`.
- Último candidato publicado: `v0.5.1-prealpha-wp5.1-r5`.
- Commit/tag r5: `a97b6ba5649e2888b909bf3c99c64acfd7042ba6`.
- ZIP: `Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r5-win-x64.zip`.
- SHA-256: `5944abf2263502ee40f49d0ac2c8a9826a809dc4cd1b20c9edf82f94ba35f8cc`.
- Destino del paquete: Windows x64. Preparación: **FIELD BLOCKED**, pendiente de condiciones de campo.
- Unity: `6000.3`; Editor registrado para probar el candidato: `6000.3.21f1`.
- Realtime Protocol, Project Transfer Protocol y Project Manifest Schema: **v1** cada uno.

## Código frente al candidato publicado

Las correcciones originales WP5.1 de #67, #68/#74, #69, #70 y #71 se integraron mediante PR #81. r5, publicado desde el commit indicado, incluye esas correcciones y la integración **Save support bundle** del Launcher posterior a r4.

El 2026-08-31, r5 exacto se probó en dos PC Windows físicos: reconexión del Guest guardado, snapshot Transform para incorporación tardía nueva, cierre durante recepción y reanudación repetidos, entrega mediante execution alias en rutas largas/profundas, y recuperación de conflicto protegido por contención de bloqueo obsoleto. Con permiso de firewall presente, también se verificaron Stop/Start del Host, nueva vinculación al Seed TCP `5091` y transferencia real al Guest.

Estos escenarios no siguen esperando su primera repetición física r5. Esto no incorpora cambios posteriores a r5 ni convierte el producto en una alpha instalable de forma general. Usa r5 para afirmaciones sobre el paquete publicado y su evidencia del 2026-08-31; no lo presentes como equivalente en bytes o comportamiento a main. No marques cierres r5 como pendientes por listas antiguas. Si se distribuye main, crea un nuevo artefacto inmutable y prueba en él lo añadido tras r5.

## Refuerzos posteriores ausentes de r5

- Incorporación del firewall LAN Windows: tras aprobación explícita del usuario y UAC puede crear reglas entrantes limitadas Coordinator/Seed, solo perfil Private y LocalSubnet, con conciliación/limpieza de reglas propias de TeamForge. r5 necesitó permiso manual; la nueva ruta requiere pruebas físicas del paquete exacto.
- Si el puerto Seed preferido/predeterminado está ocupado o no disponible, incluido `EACCES` de enlace Windows, Host reintenta una vez con puerto asignado por el SO y anuncia el endpoint seleccionado. Hay cobertura automática Windows Project Peer; es posterior a r5.
- Serialización de creación de identidad de proyecto y recuperación de fallos Windows mediante bloqueo vivo named-pipe propiedad del SO y una barrera permanente para escritores antiguos. Pasaron las suites Windows Node 22/24 de fallos/concurrencia; ningún paquete publicado con el cambio tiene evidencia física exacta.
- Limpieza de rechazos Coordinator, cancelación/plazos HTTP, contexto diagnóstico Host, registros de rol cliente WebSocket y distinción de invitaciones Launcher frente a códigos `TF1`.

Son hechos del código/automatización, no del paquete r5. La recuperación de bloqueos obsoletos de identidad en Linux/macOS queda fuera del cambio específico Windows.

## Capacidades

| Área | Estado del código | Límite de evidencia |
| --- | --- | --- |
| Presencia de usuarios | Implementada y ejercitada | Base física de dos PC funcionó; convienen más pruebas externas |
| Selección/contexto Editor | Implementada y ejercitada | Convienen más pruebas externas |
| Transform | Implementado, estabilizándose | r5 dos PC: incorporación tardía y recuperación de contención PASS; quedan cobertura y UX |
| Bloqueo/propiedad básicos | Implementados, estabilizándose | r5 contención/recuperación PASS; UX de edición bajo bloqueo ajeno en #79 |
| Hierarchy en misma Scene: crear/eliminar/renombrar/reparentar/ordenar | Implementada, estabilizándose | Subconjunto ejercitado físicamente; ampliar cobertura |
| Arranque de proyecto/Collaboration Invite | Implementado, estabilizándose | Reconexión Guest guardado r5 PASS; recuperación de identidad posterior sin evidencia paquete/campo |
| Transferencia P2P directa | Implementada, estabilizándose | r5 `5091` Stop/Start y transferencia PASS; firewall/fallback posterior sin pruebas del reemplazo |
| Diagnósticos/UX de recuperación | Implementados, estabilizándose | r5 incluye soporte con protección de privacidad; mejoras posteriores solo en código |
| Resiliencia de rutas Windows/execution alias | Implementada, estabilizándose | Entrega larga/profunda r5 PASS; rechazo de alias malicioso/ajeno cubierto automáticamente, fail-closed |
| Component/Inspector | Planificado | No se admite sincronización general de altas/bajas Component ni SerializedProperty |
| Prefab/Asset general | Planificado | No es flujo admitido actual |
| Recuperación persistente tras reinicio servidor/sesión | Planificada | Autoridad/sesión residen en memoria |
| NAT/relay Internet automático | Investigación/futuro | Sin WebRTC, ICE, STUN, TURN, relay, descubrimiento ni cruce NAT automático |

## Cierres físicos r5 exactos

Esta tabla sustituye la descripción antigua de los bloqueos como aún pendientes de validación física.

| Issue | Resultado y límite restante |
| --- | --- |
| [#67](https://github.com/Eun-si123/teamforge-unity-collab/issues/67) | **PASS**: edición/guardado legítimos, cierre Unity Guest, reapertura del mismo Active verificado y reconexión sin `guest_handoff_mismatch`. El rechazo de identidad nueva/no verificada sigue protegido por implementación estricta y regresiones automáticas |
| [#68](https://github.com/Eun-si123/teamforge-unity-collab/issues/68) | **PASS**: Guest nuevo recibe Hierarchy/Transform/Lock autoritativos y Transform posterior sin falso conflicto protegido. Más escenarios útiles; bloqueo original cerrado |
| [#74](https://github.com/Eun-si123/teamforge-unity-collab/issues/74) | **PASS**: el perdedor de contención recupera estado autoritativo y la colaboración sigue utilizable. UX de bloqueo ajeno se sigue en #79 |
| [#69](https://github.com/Eun-si123/teamforge-unity-collab/issues/69) | **PASS**: Launcher finalizado forzosamente varias veces durante recepción; reutiliza datos parciales verificados y termina sin error CLR/aplicación original. Mantener regresiones con cambios futuros de runtime |
| [#70](https://github.com/Eun-si123/teamforge-unity-collab/issues/70) | **PARCIAL PARA OBJETIVO r5 / PASS PARA SEED ESTABLE**: Host Stop/Start vuelve a enlazar TCP `5091` y transfiere con firewall permitido. Incorporación automática nueva y fallback de puerto posterior requieren paquete de reemplazo exacto en PC físicos |
| [#71](https://github.com/Eun-si123/teamforge-unity-collab/issues/71) | **PASS**: destino largo/profundo activa optimización, abre Unity y permite colaboración. Rechazo de alias malicioso/ajeno/redirigido sigue siendo cobertura automática fail-closed |

Los detalles temporales pertenecen a Issues; su efecto actual sobre la publicación, a STATUS.

## Evidencia automática y local

Antes de fusionar PR #81, su head integrado pasó las protecciones registradas en `docs/MAIN_PATCH_STATUS_2026-08-27.md`:

- CI #216: Server, Project Peer, cargador runtime Launcher, Windows Launcher y contrato de código público: **PASS**.
- Dependency Review #140: **PASS**.
- Unity Tests #73: Lock Contention E2E, Realtime Authority E2E, Realtime Authority Chaos E2E y Project Transfer Resume E2E: **PASS**.
- Unity Test Runner local anterior: **143/143 PASS** ejecutables localmente; dos pruebas con servidor real exclusivas de CI omitidas intencionalmente en local.
- Recuperación A/B en una máquina: **PASS**. Convergencia tardía A/B/C de Hierarchy/Transform: **PASS**, cero conflictos protegidos en la ejecución registrada.

Los refuerzos posteriores tienen pruebas focalizadas Project Peer/Launcher/Unity y controles habituales. La suite Windows de identidad pasó en Node 22/24 admitidos; el caso Seed no disponible pasó la suite completa Project Peer en el entorno Windows reproducido. Refuerza confianza en el código, no prueba bytes publicados antes del arreglo.

## Evidencia física registrada

La base del 2026-08-22 mostró Host→invitación firmada→Guest nuevo→autenticación→transferencia directa→confianza Publisher→Active verificado→Unity conectado; Presence y Transform bidireccional; contención normal; crear/renombrar/reparentar/ordenar hermanos/eliminar en misma Scene; salida/reapertura Guest sin guardar con recuperación Hierarchy/Transform/Lock desde la sesión viva; corte TCP Coordinator y reintento/reconexión automática sin reiniciar Unity.

El 2026-08-31 se usaron el ZIP/SHA r5 exactos en dos PC para cerrar reconexión guardada, incorporación tardía, recepción/reanudación repetidas, rutas largas y contención. También se verificó Seed `5091` Stop/Start y LAN real; el firewall nuevo todavía exigía permiso manual.

## Límites de la evidencia

Solo se demuestra lo ejercitado. CI del código no demuestra el ZIP. Automatización Unity no reproduce todos los órdenes de entrada SceneView, procesos Windows, estados LAN/firewall ni tiempos de la segunda máquina. Pruebas en una máquina comparten SO, pila de red, tiempos y hardware. r5 físico no prueba main posterior. La versión no identifica bytes: hacen falta nombre exacto y SHA-256. Cerrar un bug no valida físicamente cambios futuros del subsistema. Registros históricos siguen válidos para su instantánea, pero no sustituyen STATUS actual.

## Condiciones pendientes antes de una alpha general

1. Conservar los cierres r5 #67/#68/#69/#71/#74 como completados.
2. Publicar un candidato nuevo e inmutable si se distribuye main.
3. En ese artefacto exacto, validar firewall nuevo, alcance/ciclo de reglas, fallback de puerto preferido ocupado/no disponible, alcanzabilidad del Seed anunciado, Stop/Start Host y transferencia Guest nueva.
4. Validar recuperación Windows de identidad tras pérdida del proceso y rechazo fail-closed de identidades ambiguas/conflictivas.
5. Ejecutar smoke con extracción nueva Host→Guest nuevo→colaboración; no heredar evidencia r5 por suposición.
6. Registrar nombre/SHA/identidad de fuente exactos y solo escenarios realmente ejecutados.
7. Avanzar guías de instalación/actualización/desinstalación y obtener pruebas/revisión de personas distintas del creador antes de afirmar fiabilidad amplia.

Reiniciar el servidor es **desconexión/fail-closed/recuperación con sesión nueva**, no prueba de persistencia: no se implementó recuperación duradera de autoridad/sesión.

## Fuentes responsables

Capacidades/bloqueos: [STATUS inglés](STATUS.md); versiones: [contrato](../release-contract.json); bytes vigentes/sustituidos: [builds](../builds/README.md) y SHA-256 Release; flujo: [Cómo funciona](HOW_IT_WORKS.es.md); planes: [ROADMAP](ROADMAP.md); estructura: [architecture](architecture.md); decisiones: [architecture-decisions](architecture-decisions.md); escenarios: [TEST_LAB](TEST_LAB.md); bugs: Issues; pruebas antiguas: notas fechadas. Los documentos detallados sin traducción siguen en inglés.
