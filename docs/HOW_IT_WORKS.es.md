# Cómo funciona TeamForge

Esta página explica **qué ocurre al alojar, unirse, transferir un proyecto, editar una Scene, desconectarse o recuperarse de un fallo**. Es una explicación guiada, no una especificación completa del protocolo ni un mapa del código.

Consulta [Estado](STATUS.es.md) para capacidades y bloqueos; [architecture](architecture.md) para topología y confianza; [CODEMAP](../CODEMAP.md) para archivos; [architecture-decisions](architecture-decisions.md) para motivos. Las referencias detalladas no traducidas siguen en inglés. [El original inglés](HOW_IT_WORKS.md) determina el significado.

## Modelo de 60 segundos

Hay dos rutas deliberadamente separadas:

- Los Unity Editor Host/Guest envían operaciones en tiempo real por WebSocket a Session Authority del Server.
- Host Unity utiliza Host Project Peer/Seed; Guest Launcher utiliza Guest Project Peer. Los peers transfieren el contenido por HTTP directo y entregan el Active verificado al Guest Unity.
- Server coordina metadatos firmados con ambos peers, sin convertirse en relay de archivos.
- Guest solo abre contenido después de validar confianza, integridad, activación y entrega a Unity.

Así se aparta la transferencia grande del tráfico sensible a latencia manteniendo una única autoridad en tiempo real.

## Procesos principales

### Paquete Unity Editor

Proporciona flujo Host, ciclo de conexión, Presence, Transform/Lock y Hierarchy de misma Scene admitidos, diagnósticos/recuperación y aplicación segura de estado remoto aprobado. El cliente **observa la autoridad**: un valor local no se vuelve autoritativo por existir en un Editor.

### TeamForge Server

**Session Authority** gestiona miembros, revisión/orden compartidos, locks/leases, estado Scene admitido retenido, protección replay/idempotencia y efectos en tiempo real. **Project Coordinator** coordina metadatos firmados de proyecto/publisher/baseline/peer. No almacena ni retransmite el contenido normal Manifest/File/Chunk.

### Project Peer

Gestiona validación de invitaciones firmadas, manifiestos y hashes deterministas, HTTP directo, reanudación verificada, staging, revisiones Active inmutables, seguridad de archivos/rutas y confianza proyecto/publisher. Descargar con éxito no basta para activar: debe pasar toda la ruta de verificación y confianza.

### Windows Guest Launcher

Un Guest nuevo empieza fuera de Unity porque puede no tener proyecto. Launcher verifica el Runtime incluido, invitación y confianza, recibe mediante Project Peer, valida Active final y Unity requerido y entrega el proyecto a Unity. El Guest empaquetado normal no instala ni opera manualmente Node.js/npm del sistema.

El código Launcher actual también crea un **paquete de soporte local manual**: ZIP de observación acotado y con datos sensibles ocultos. No se sube automáticamente, no concede autoridad ni evita validación de invitación, confianza, activación, Runtime, rutas o entrega Unity. Su presencia en un candidato depende del artefacto exacto; [Estado](STATUS.es.md) y [builds](../builds/README.md) distinguen código y paquete.

## Cuando Host inicia colaboración

1. Elige **Publish & Start**.
2. Unity comprueba requisitos del proyecto local y Scene guardada.
3. Project Peer prepara una baseline determinista y asigna identidades de integridad a archivos/chunks.
4. Host Peer inicia Seed de transferencia directa.
5. Coordina metadatos proyecto/publisher/baseline/peer con Server.
6. Crea Collaboration Invite firmada y queda preparado para Guests.

Hay más controles fail-closed. **Host Ready es más que abrir un puerto**: están establecidos los contratos de transferencia y sesión necesarios. La invitación no está destinada a transportar código de acceso, clave privada de firma ni ruta local arbitraria. El código de acceso, cuando se usa, se comparte por separado.

## Cuando se une un Guest nuevo

1. Abre Windows Guest Launcher y verifica Runtime incluido.
2. Carga/pega invitación y valida estructura/firma.
3. Inspecciona identidad y confianza de Project/Owner/Publisher.
4. Contacta Host/Seed coordinado y recibe descriptor/manifest/inventory.
5. Descarga solo chunks necesarios y verifica integridad de chunk, archivo, manifiesto y proyecto.
6. Construye en staging y verifica el candidato completo.
7. Crea revisión Active inmutable y mueve el pequeño puntero al proyecto actual.
8. Valida ejecutable Unity requerido y entrega final; abre el proyecto verificado.

Un directorio descargado parcialmente no se convierte arbitrariamente en proyecto actual. Active anterior verificado puede conservarse mientras se recibe una revisión nueva o falla la activación.

### Reanudación consciente de verificación

Tras una interrupción puede reutilizar contenido ya verificado donde el contrato lo permite. No equivale a confiar en cualquier archivo del disco: siguen mandando hashes y contrato de activación.

## Al editar un objeto Scene admitido

1. El usuario mueve GameObject; el servicio Transform observa el cambio.
2. Resuelve la identidad canónica de autoridad del objeto.
3. Comprueba lock/lease y autoridad de conexión; envía operación Transform por WebSocket.
4. Session Authority valida y aplica orden, revisión e idempotencia.
5. Difunde el efecto aprobado a otros clientes.
6. El receptor actualiza Authority View y Unity aplica el Transform remoto aprobado de forma segura.

**Identidad:** ambos Editor deben referirse al **mismo objeto lógico**, no solo coincidir en nombre/ruta Hierarchy. Objetos de Scene guardada usan identidad estable Unity; objetos admitidos creados en sesión pueden recibir identidad lógica TeamForge tras vinculación autoritativa. Ambigüedad produce fail-closed, no suposiciones por nombre, índice de hermano o ruta.

**Autoridad:** Server decide el estado compartido aceptado. Clientes comunican intención y aplican resultados, sin verdades independientes competidoras.

**Revisión/orden:** operaciones aceptadas avanzan el orden autoritativo. La revisión permite razonar sobre estado obsoleto, incorporaciones tardías, replay y si se evaluó la operación frente al estado esperado.

**Lock/lease:** bloqueos controlados por autoridad impiden sobrescrituras silenciosas simultáneas. Los leases expiran si desaparece un cliente, en vez de quedar permanentes.

**Replay/idempotencia:** distingue un reintento legítimo de la misma operación de otra que intenta reutilizar identidad. Entregar un mensaje dos veces no debe mutar el estado dos veces.

## Cambios Hierarchy

Crear/eliminar/renombrar/reparentar/ordenar hermanos en misma Scene usa una ruta autoritativa aparte, no operaciones Transform fingidas. Transform depende de estructura: con distintos padres o identidades, los mismos números locales pueden producir Scenes distintas. No infieras sincronización general Component/Inspector/Prefab/Asset ni estructura arbitraria entre Scenes; consulta [Estado](STATUS.es.md).

## Reconexión y épocas

Reconectar no prueba que la autoridad anterior siga vigente. El flujo es: perder conexión, dejar de confiar en su autoridad, reconectar/handshake, recibir capacidades negociadas y estado autoritativo actuales, revincular objetos admitidos para la nueva época y reanudar solo cuando el estado requerido está listo. Alias persistidos e identidades cacheadas pueden ayudar a resolver, pero no conceden autoridad por sí mismos.

## Fallos y recuperación

Se conserva estado verificado en lugar de forzar estado desconocido:

- Runtime dañado: detener antes de ejecutar código no verificado.
- Invitación inválida/conflictiva: conservar vinculación de proyecto existente.
- Fallo de transferencia: preservar progreso verificado reutilizable donde se permita.
- Fallo de activación: no sustituir Active anterior verificado.
- Problema de ruta Unity: usar solo estrategia propia TeamForge validada por separado.
- Baseline/identidad distinta: exigir conciliación/actualización, no adivinar.
- Proceso desconocido en puerto necesario: no terminarlo solo para conseguir el puerto.

Las acciones dependen del **estado**. Retry, Paste New Invite, Use Latest Project, Open Existing Verified Project y Choose Unity solo se ofrecen donde tienen un significado seguro definido.

**Diagnósticos observan, no otorgan autoridad de recuperación.** Copiarlos o guardar el ZIP ayuda a describir la ejecución. Guardar no selecciona otro Project, reintenta, confía en Publisher, activa ni relaja controles. Recoge una vista segura acotada, no datos amplios de proyecto/máquina; aun así debe revisarse antes de publicarla.

## Por qué separar transferencia y colaboración

La colaboración se beneficia de mensajes autoritativos pequeños y ordenados. El arranque puede implicar muchos archivos, grandes flujos de bytes, reintentos, resume, hashes, staging y disco. Separarlos evita un cuello de botella oculto de bytes en Server y aclara límites de seguridad/fallo.

A cambio, Guest debe alcanzar realmente Host Peer. Encaja en mismo PC, LAN alcanzable o VPN administrada. Descubrimiento Internet/NAT/relay automáticos son problemas futuros de transporte, no una promesa implícita de P2P.

## Dónde vive el estado

| Estado | Duración/responsable |
| --- | --- |
| Session Authority | Memoria Server de la sesión viva |
| Registro de coordinación | Memoria Server |
| Client Authority View | Conexión Unity actual |
| Transferencia/staging | Almacenamiento gestionado Project Peer |
| Revisiones Active verificadas | Almacenamiento gestionado Project duradero |
| Puntero Active actual | Metadato pequeño persistente |
| Historial diagnóstico Launcher | Acotado a la ejecución actual |
| Support bundle manual | ZIP local creado por usuario, acotado y depurado; sin carga automática |

Un proyecto descargado persistente no implica historial de autoridad persistente, y un diagnóstico guardado no se convierte en autoridad. Esta diferencia importa para reiniciar, reconectar, reanudar y recuperar.

## Seguir el comportamiento al código

[CODEMAP](../CODEMAP.md) mantiene archivos y pruebas exactos para que esta guía resista refactorizaciones. Rutas habituales: conexión → Unity `TeamForgeConnectionService` y host WebSocket Server; Transform/Lock → servicio Transform, Authority View y Session Authority; Hierarchy → servicio Unity y modelo Server/Session Authority; transferencia → orquestadores Host/Guest Peer, fuente directa y almacén de contenido; inicio/recuperación Guest → Windows Launcher, Launcher Core y orquestador Guest; soporte → UI diagnóstico y bundle/redacción Core; rutas resilientes → Launcher Core y contrato compartido Project Peer.
