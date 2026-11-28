# Estado actual de TeamForge

> Actualización del código del 26-11-2026 (no es una nueva versión): #643 (recuperación del bloqueo Transform) y #617/#618 (validación de evidencias físicas) están integradas en main. r11 incluye M1–M4, incluida la recuperación SQLite opcional, y pasó la validación automática del ZIP exacto; r10 no cambió. Las pruebas de las nuevas funciones con dos Editores físicos Windows, la identidad del ZIP instalado y las pruebas prolongadas siguen sin realizarse. M5 está parcialmente implementado: vista previa de cambios guardados del Host #586 y revisión de actualización firmada del Guest #578. La integración #620 sigue en borrador sin fusionar; la transición M4→M5 durante la ejecución y la sincronización en vivo de Prefabs arbitrarios no están completas. Esta actualización prevalece sobre la traducción histórica que sigue. El estado sigue siendo FIELD BLOCKED. [STATUS.md](STATUS.md)

> **Actualización del código fuente, 22-11-2026 (no es una nueva versión):** Los PR #578, #611, #610, #613 y #608 ya están integrados en main. El #612 también se ha integrado y el #607, sobre la edición nativa de Unity, continúa como borrador. La sincronización en tiempo real de Prefabs externos y las pruebas con dos equipos Windows todavía no están completas. El ZIP r11 publicado no ha cambiado; el estado sigue siendo **FIELD BLOCKED**. Consulta el [estado actualizado en inglés](STATUS.md).

> **r11 release update (2026-11-21):** [r11 Windows test ZIP](https://github.com/Eun-si123/teamforge-unity-collab/releases/tag/v0.5.1-prealpha-wp5.1-r11) passed exact ZIP validation, but new M1–M4 functions have NOT passed two-physical-PC Windows tests; **FIELD BLOCKED** remains. The text below is a dated translation snapshot; refer to the [current English STATUS](STATUS.md) for up-to-date claims.

[English](STATUS.md) · [Cómo funciona](HOW_IT_WORKS.es.md)

_Esta traducción de vista previa se revisó frente a la versión del 2026-11-20 del documento canónico `STATUS.md` en inglés. Para evidencia detallada, Issues y decisiones actuales, prevalece la versión inglesa._

**Actualización del código, 2026-11-20:** M4 (#572) incorpora recuperación opcional de Sessions mediante SQLite. Las pruebas r9/r10 con dos PCs Windows reales para colaboración básica y reconexión ya se realizaron y se notificaron como PASS; no cubrieron M4. El paquete publicado r10 no cambia y la preparación sigue **FIELD BLOCKED**.


> **Vista previa pública temprana: no uses TeamForge como única copia ni único mecanismo de recuperación de un Unity Project importante.** Mantén copias de seguridad y, de ser posible, prueba con Projects desechables.

> **2026-10-20 r9 field evidence:** Published r9 passed exact-release validation; user-reported two-PC basic collaboration and Guest reconnect PASS. Full recovery/negative field gate remains BLOCKED. [Current detail](https://github.com/Eun-si123/teamforge-unity-collab/blob/main/docs/STATUS.md).
> **2026-11-04 r10 user-reported two-PC field signal (not a package certification):** Basic Host/Guest collaboration, receive/reconnect, access-code rejection and one long destination were reported PASS; separate installed ZIP hashes were **not** checked on both machines. The published r10 ZIP passed [automated Exact Release Validation #41630492102](https://github.com/Eun-si123/teamforge-unity-collab/actions/runs/41630492102), but an actual Guest Wi-Fi/NIC outage was **NOT RUN** ([#457](https://github.com/Eun-si123/teamforge-unity-collab/issues/457)) and repeated Launcher startup exposed a defect (fixed in later source [#456](https://github.com/Eun-si123/teamforge-unity-collab/pull/456), **not** in r10). Full field readiness is **FIELD BLOCKED**. [Dated evidence](PHYSICAL_FIELD_EVIDENCE_2026-11-04_R10.md).

## Resumen actual

- Línea de producto: `0.5.1`
- Source lineage: `0.5.1-wp5.1-path-resilience`
- Último candidato publicado: `v0.5.1-prealpha-wp5.1-r11`
- Source commit de r11: `5868efe02975aa94b2acd79f5dec39a7b830aa26`
- ZIP de Windows: `Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r11-win-x64.zip`
- SHA-256: `28774bccb9fb20da0d72fce38d9bab7645dac1b876de182fbd33ee421170a989`
- Objetivo: Windows x64
- Preparación de lanzamiento: **FIELD BLOCKED**
- Línea de Unity: `6000.3` (Editor de prueba registrado: `6000.3.21f1`)
- Realtime / Project Transfer / Project Manifest: **v1**

## Integración M1 en el código fuente: edición compartida de Collider

M1 se activa explícitamente desde el código fuente y no forma parte del ZIP r10 publicado. Comparte trigger, center y size/radius de BoxCollider/SphereCollider en Scenes guardadas sin Prefab mediante la ruta real: verificación de bytes Scene/meta firmados → Server Authority → WebSocket → Unity Editor. Tras la admisión inicial, las ediciones continuas sin guardar usan el ledger del servidor, revision/history comunes y el lock de GameObject. La ventana Collider Collaboration ofrece Undo/Redo condicional de los cambios propios y una bandeja de recuperación para revisar y reenviar explícitamente valores locales sin confirmar. El commit del servidor, el informe de aplicación del Editor y el guardado en disco son estados distintos.

La evidencia se divide en cuatro etapas. **Implementación**: M1 se fusionó en main mediante [PR #533](https://github.com/Eun-si123/teamforge-unity-collab/pull/533). **Validación automática**: pasan las pruebas reales de Node WebSocket. **Integración Unity**: el [CI del código exacto](https://github.com/Eun-si123/teamforge-unity-collab/actions/runs/43329700733) pasó la edición de Collider, Undo condicional y reconexión con un Editor real y un peer Node en tres versiones de Unity; la ejecución local de Unity en Linux sigue NOT RUN. **Paquete y Windows físico**: la prueba con dos Editors físicos y un nuevo paquete sigue **NOT RUN**. El ZIP r10 publicado no cambia y el estado sigue **FIELD BLOCKED**. La adición/eliminación M2 [#559](https://github.com/Eun-si123/teamforge-unity-collab/pull/559) y la corrección de incorporación tardía [#565](https://github.com/Eun-si123/teamforge-unity-collab/pull/565) se fusionaron en main el 2026-11-18 como función de código fuente con activación explícita. El CI pasó con un Editor real y un peer Node en tres versiones de Unity; dos Editors físicos y un paquete nuevo siguen **NOT RUN**. El r10 publicado no incluye M1/M2. El 2026-11-19, M3 para crear y eliminar Cube/Sphere integrados se fusionó a main en PR #569 como función de código fuente opt-in. Pasó el CI con un Editor real y un peer Node en tres versiones Unity (40 verificaciones PR). Dos Editors físicos y un paquete nuevo siguen NOT RUN; el r10 publicado no lo incluye y el estado sigue FIELD BLOCKED.

Límites: una Scene por Session, 128 Sessions retenidas en memoria, 512 Colliders/1536 propiedades y valores finitos ±100/0–100. Los campos no admitidos son locales. Añadir/eliminar Components, Prefabs y eliminar el objeto propietario de un Collider admitido o sus ancestros requieren M2 y se rechazan en esta ruta M1. Los editores deben negociar y unirse a la capacidad compatible. El ledger permanece al desconectarse todos los peers, pero **se pierde al reiniciar el servidor si M4 no está habilitado**. El modo opcional M4 ya integrado guarda en SQLite el estado confirmado de la Session. Dos Unity Editors, late join de tres usuarios, guardar/reabrir, ocho Editors durante una hora y el artefacto Windows exacto siguen pendientes por separado. M2/M3/M4 ya están integrados en el código; sus pruebas físicas siguen siendo independientes. Consulta [STATUS en inglés](STATUS.md) y la [configuración](../server/README.md).

## Publicación r8 y alcance de la evidencia

r8 se publicó el 2026-10-10 e incorpora las correcciones de PR #209 para comprobar Direct Seed, abrir un Existing-Active verificado y rechazar raíces de proyecto anidadas. El ZIP publicado superó Windows Exact Release Validation (ejecución 38019297086), pero **todavía no se ha probado r8 en dos PC Windows físicos**; el estado sigue **FIELD BLOCKED**. Las pruebas de r7 que se describen más abajo son históricas, no pruebas de campo de r8. Los PR #217 y #219 se integraron después y no están en el ZIP r8.

## Límite de evidencia de r7

r7 se publicó el 2026-10-03 desde el commit d88ca4c41ecf1f9cc7aa5d349960f407f158ce9a y después superó la **Exact Release Validation** de Windows. La automatización volvió a descargar el ZIP del Release, verificó su SHA-256 y todos los hashes del release manifest, hizo una extracción nueva en una ruta con caracteres coreanos y espacios desde otro directorio de trabajo, y verificó Runtime/Node empaquetado, comportamiento fail-closed del Launcher, Windows path resilience y junctions reales.

Esto es **evidencia automatizada del paquete exacto**. En una prueba física posterior con Host r6 y Guest r7 exacto, el Guest reutilizó el managed root existente sin `destination_contains_unmanaged_content`; después de cambiar la red LAN confiable del Host de Public a Private, el flujo avanzó por Publisher trust, Project receive y apertura de Unity hasta una conexión de TeamForge informada por el usuario. Aún no prueba r7 exacto en ambos PCs, onboarding UAC nuevo sin elevación, fallback del puerto Seed ni recuperación física de Project identity tras pérdida anormal del proceso. Por eso sigue **FIELD BLOCKED**.

La evidencia física de r5 del 2026-08-31 sigue siendo válida para los escenarios que realmente se ejecutaron entonces: reconnect, late join, receive/resume, long path, lock contention y Seed `5091`/transferencia. Publicar r7 no cambia los bytes ni los resultados históricos de r5.

## Bloqueos posteriores de r7-on-Host y nuevas pruebas con r8

Las pruebas físicas posteriores detectaron `baseline_unavailable` aunque el Host mostraba Ready sin un Direct Project Peer disponible, un `DirectoryNotFoundException` por rutas largas al abrir un Project verificado existente. La revisión del Source también identificó el riesgo de UUID anidados al elegir el directorio de un Project como Projects root.

PR #209 se integró en `main` el 2026-10-08; sus correcciones están **incluidas en el ZIP r8 publicado**. r8 superó Windows Exact Release Validation (ejecución 38019297086), pero falta repetir las pruebas en dos PC Windows físicos: retirar Ready cuando desaparece Direct Seed, reabrir Existing-Active mediante la ruta corta y rechazar un directorio Project UUID como Projects root. La causa original de la pérdida de Seed sigue sin confirmarse. El PASS mixto r6/r7 anterior conserva solo su alcance original; el estado sigue **FIELD BLOCKED**.

[PR #209](https://github.com/Eun-si123/teamforge-unity-collab/pull/209) · [English evidence/status](https://eun-si123.github.io/teamforge-unity-collab/status/#later-r7-on-host-blockers-now-packaged-for-r8-retest)

## Alcance actual

Presence, Selection, sincronización Transform, lock/ownership básico, operaciones Same-Scene Hierarchy compatibles, Project transfer P2P directo, UX de diagnóstico/recuperación y Windows path resilience están implementados o en estabilización. r7 incluye además firewall onboarding de Windows posterior a r5, fallback de Seed port ocupado/no disponible, Windows Project identity crash recovery, diagnósticos adicionales y el aviso SceneView `TeamForge · Locked by <owner>`.

La sincronización general Component/Inspector, Prefab/Asset general y el NAT traversal/relay automático de Internet siguen sin ser funciones compatibles. La persistencia opcional M4 está implementada en el código, pero falta validarla en dos Editors físicos y un nuevo paquete.

## Validación física pendiente

1. Extraer **r11 exacto** en dos PCs Windows nuevos y comprobar Firewall onboarding/UAC, reglas limitadas a Private + `LocalSubnet` y su lifecycle.
2. Forzar conflicto/no disponibilidad del Seed port preferido; comprobar que el endpoint anunciado tras fallback sea realmente accesible, además de Host Stop/Start y Fresh Guest transfer.
3. Simular pérdida anormal del proceso durante Project identity y confirmar recuperación segura, manteniendo fail closed ante identidades ambiguas o conflictivas.
4. Ejecutar Fresh Host → Fresh Guest → Unity realtime smoke y comprobar que el feedback de foreign lock sea claro y desaparezca tras release/takeover.
5. Mantener #182 como vigilancia de CI intermitente sin ocultarlo con retry/skip; #79 sigue como seguimiento UX del movimiento local transitorio en SceneView.

## Fuente de verdad

Para detalles de capacidades, bloqueos y evidencia usa [English STATUS](STATUS.md); para selecciones exactas [`release-contract.json`](../release-contract.json); para identidad de bytes publicados [`builds/README.md`](../builds/README.md) y el SHA-256 del GitHub Release.
