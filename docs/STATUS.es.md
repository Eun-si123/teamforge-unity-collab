# Estado actual de TeamForge

[English](STATUS.md) · [Cómo funciona](HOW_IT_WORKS.es.md)

_Esta traducción de vista previa se revisó frente a la versión del 2026-10-03 del documento canónico `STATUS.md` en inglés. Para evidencia detallada, Issues y decisiones actuales, prevalece la versión inglesa._

> **Vista previa pública temprana: no uses TeamForge como única copia ni único mecanismo de recuperación de un Unity Project importante.** Mantén copias de seguridad y, de ser posible, prueba con Projects desechables.

## Resumen actual

- Línea de producto: `0.5.1`
- Source lineage: `0.5.1-wp5.1-path-resilience`
- Último candidato publicado: `v0.5.1-prealpha-wp5.1-r6`
- Source commit de r6: `b479244a40ebf3f1e56787edd044d06b2d050e2b`
- ZIP de Windows: `Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r6-win-x64.zip`
- SHA-256: `4a411e8769fd39a2cfa46feaf0bb6e711e8fbd1b5c0d98b5e74a93d7ebf3a64a`
- Objetivo: Windows x64
- Preparación de lanzamiento: **FIELD BLOCKED**
- Línea de Unity: `6000.3` (Editor de prueba registrado: `6000.3.21f1`)
- Realtime / Project Transfer / Project Manifest: **v1**

## Límite de evidencia de r6

r6 se publicó el 2026-10-03 desde el commit anterior y después superó la **Exact Release Validation** de Windows. La automatización volvió a descargar el ZIP del Release, verificó su SHA-256 y todos los hashes del release manifest, hizo una extracción nueva en una ruta con caracteres coreanos y espacios desde otro directorio de trabajo, y verificó Runtime/Node empaquetado, comportamiento fail-closed del Launcher, Windows path resilience y junctions reales.

Esto es **evidencia automatizada del paquete exacto**. No prueba todavía Firewall/UAC en dos PCs físicos, alcance LAN real, recuperación de Project identity tras una pérdida anormal del proceso ni el flujo completo Host → Guest → realtime. Por eso sigue **FIELD BLOCKED**.

La evidencia física de r5 del 2026-08-31 sigue siendo válida para los escenarios que realmente se ejecutaron entonces: reconnect, late join, receive/resume, long path, lock contention y Seed `5091`/transferencia. Publicar r6 no cambia los bytes ni los resultados históricos de r5.

## Alcance actual

Presence, Selection, sincronización Transform, lock/ownership básico, operaciones Same-Scene Hierarchy compatibles, Project transfer P2P directo, UX de diagnóstico/recuperación y Windows path resilience están implementados o en estabilización. r6 incluye además firewall onboarding de Windows posterior a r5, fallback de Seed port ocupado/no disponible, Windows Project identity crash recovery, diagnósticos adicionales y el aviso SceneView `TeamForge · Locked by <owner>`.

La sincronización general Component/Inspector, Prefab/Asset general, recuperación persistente tras reinicio de server/session y NAT traversal/relay automático de Internet siguen sin ser funciones compatibles.

## Validación física pendiente

1. Extraer **r6 exacto** en dos PCs Windows nuevos y comprobar Firewall onboarding/UAC, reglas limitadas a Private + `LocalSubnet` y su lifecycle.
2. Forzar conflicto/no disponibilidad del Seed port preferido; comprobar que el endpoint anunciado tras fallback sea realmente accesible, además de Host Stop/Start y Fresh Guest transfer.
3. Simular pérdida anormal del proceso durante Project identity y confirmar recuperación segura, manteniendo fail closed ante identidades ambiguas o conflictivas.
4. Ejecutar Fresh Host → Fresh Guest → Unity realtime smoke y comprobar que el feedback de foreign lock sea claro y desaparezca tras release/takeover.
5. Mantener #182 como vigilancia de CI intermitente sin ocultarlo con retry/skip; #79 sigue como seguimiento UX del movimiento local transitorio en SceneView.

## Fuente de verdad

Para detalles de capacidades, bloqueos y evidencia usa [English STATUS](STATUS.md); para selecciones exactas [`release-contract.json`](../release-contract.json); para identidad de bytes publicados [`builds/README.md`](../builds/README.md) y el SHA-256 del GitHub Release.
