# Estado actual de TeamForge

[English](STATUS.md) · [Cómo funciona](HOW_IT_WORKS.es.md)

_Esta traducción de vista previa se revisó frente a la versión del 2026-10-08 del documento canónico `STATUS.md` en inglés. Para evidencia detallada, Issues y decisiones actuales, prevalece la versión inglesa._

> **Vista previa pública temprana: no uses TeamForge como única copia ni único mecanismo de recuperación de un Unity Project importante.** Mantén copias de seguridad y, de ser posible, prueba con Projects desechables.

## Resumen actual

- Línea de producto: `0.5.1`
- Source lineage: `0.5.1-wp5.1-path-resilience`
- Último candidato publicado: `v0.5.1-prealpha-wp5.1-r8`
- Source commit de r7: `4aff5756329c2fe013d78344859e0760c6a382ef`
- ZIP de Windows: `Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r8-win-x64.zip`
- SHA-256: `3a003791043c067009250bf59da4d916e75eb6dc1b1ed0e93d54984a2d23eb21`
- Objetivo: Windows x64
- Preparación de lanzamiento: **FIELD BLOCKED**
- Línea de Unity: `6000.3` (Editor de prueba registrado: `6000.3.21f1`)
- Realtime / Project Transfer / Project Manifest: **v1**

## Publicación r8 y alcance de la evidencia

r8 se publicó el 2026-10-10 e incorpora las correcciones de PR #209 para comprobar Direct Seed, abrir un Existing-Active verificado y rechazar raíces de proyecto anidadas. El ZIP publicado superó Windows Exact Release Validation (ejecución 38019297086), pero **todavía no se ha probado r8 en dos PC Windows físicos**; el estado sigue **FIELD BLOCKED**. Las pruebas de r7 que se describen más abajo son históricas, no pruebas de campo de r8. Los PR #217 y #219 se integraron después y no están en el ZIP r8.

## Límite de evidencia de r7

r7 se publicó el 2026-10-03 desde el commit d88ca4c41ecf1f9cc7aa5d349960f407f158ce9a y después superó la **Exact Release Validation** de Windows. La automatización volvió a descargar el ZIP del Release, verificó su SHA-256 y todos los hashes del release manifest, hizo una extracción nueva en una ruta con caracteres coreanos y espacios desde otro directorio de trabajo, y verificó Runtime/Node empaquetado, comportamiento fail-closed del Launcher, Windows path resilience y junctions reales.

Esto es **evidencia automatizada del paquete exacto**. En una prueba física posterior con Host r6 y Guest r7 exacto, el Guest reutilizó el managed root existente sin `destination_contains_unmanaged_content`; después de cambiar la red LAN confiable del Host de Public a Private, el flujo avanzó por Publisher trust, Project receive y apertura de Unity hasta una conexión de TeamForge informada por el usuario. Aún no prueba r7 exacto en ambos PCs, onboarding UAC nuevo sin elevación, fallback del puerto Seed ni recuperación física de Project identity tras pérdida anormal del proceso. Por eso sigue **FIELD BLOCKED**.

La evidencia física de r5 del 2026-08-31 sigue siendo válida para los escenarios que realmente se ejecutaron entonces: reconnect, late join, receive/resume, long path, lock contention y Seed `5091`/transferencia. Publicar r7 no cambia los bytes ni los resultados históricos de r5.

## Bloqueos posteriores de r7-on-Host y correcciones sin integrar

Las pruebas físicas posteriores detectaron `baseline_unavailable` aunque el Host mostraba Ready sin un Direct Project Peer disponible, un `DirectoryNotFoundException` por rutas largas al abrir un Project verificado existente. La revisión del Source también identificó el riesgo de UUID anidados al elegir el directorio de un Project como Projects root.

Desde el 2026-10-08, PR #209 está integrado en `main`. Las correcciones ya están en el código fuente, pero **no** en el ZIP r7 publicado. El CI, las pruebas de Unity y Engineering Quality Gate del PR actualizado pasaron; aún falta un candidato inmutable independiente con validación exact-release y pruebas físicas. El PASS mixto r6/r7 anterior conserva solo su alcance original; el estado sigue **FIELD BLOCKED**.

[PR #209](https://github.com/Eun-si123/teamforge-unity-collab/pull/209) · [English evidence/status](https://eun-si123.github.io/teamforge-unity-collab/status/#later-r7-on-host-blockers-now-packaged-for-r8-retest)

## Alcance actual

Presence, Selection, sincronización Transform, lock/ownership básico, operaciones Same-Scene Hierarchy compatibles, Project transfer P2P directo, UX de diagnóstico/recuperación y Windows path resilience están implementados o en estabilización. r7 incluye además firewall onboarding de Windows posterior a r5, fallback de Seed port ocupado/no disponible, Windows Project identity crash recovery, diagnósticos adicionales y el aviso SceneView `TeamForge · Locked by <owner>`.

La sincronización general Component/Inspector, Prefab/Asset general, recuperación persistente tras reinicio de server/session y NAT traversal/relay automático de Internet siguen sin ser funciones compatibles.

## Validación física pendiente

1. Extraer **r7 exacto** en dos PCs Windows nuevos y comprobar Firewall onboarding/UAC, reglas limitadas a Private + `LocalSubnet` y su lifecycle.
2. Forzar conflicto/no disponibilidad del Seed port preferido; comprobar que el endpoint anunciado tras fallback sea realmente accesible, además de Host Stop/Start y Fresh Guest transfer.
3. Simular pérdida anormal del proceso durante Project identity y confirmar recuperación segura, manteniendo fail closed ante identidades ambiguas o conflictivas.
4. Ejecutar Fresh Host → Fresh Guest → Unity realtime smoke y comprobar que el feedback de foreign lock sea claro y desaparezca tras release/takeover.
5. Mantener #182 como vigilancia de CI intermitente sin ocultarlo con retry/skip; #79 sigue como seguimiento UX del movimiento local transitorio en SceneView.

## Fuente de verdad

Para detalles de capacidades, bloqueos y evidencia usa [English STATUS](STATUS.md); para selecciones exactas [`release-contract.json`](../release-contract.json); para identidad de bytes publicados [`builds/README.md`](../builds/README.md) y el SHA-256 del GitHub Release.
