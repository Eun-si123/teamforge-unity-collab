# Compatibilidad de TeamForge

Esta página describe **los límites de compatibilidad y topología para las personas que usan el proyecto**.

- Selecciones exactas actuales de producto, runtime y protocolo → [`../release-contract.json`](../release-contract.json)
- Validación y preparación actuales → [STATUS.md](STATUS.md)
- Identidad del artefacto empaquetado → [`../builds/README.md`](../builds/README.md) + SHA-256 exacto de la Release

Evita copiar en varios documentos los números de parche de herramientas o runtime que cambian con frecuencia. El contrato de versión mantiene esas selecciones exactas.

## Antes de probar

Usa un proyecto desechable y conserva copias de seguridad: TeamForge es una versión preliminar pública inicial. [STATUS.md](STATUS.md) mantiene los límites actuales de validación en entornos reales. La tabla de plataformas distingue el destino del paquete de los requisitos de código fuente y compilación.

Los requisitos mínimos de CPU, RAM, GPU, disco, ancho de banda y latencia aún no se han establecido mediante pruebas controladas. Que un prototipo funcione no constituye una recomendación de hardware mínimo.

Los Guest deben poder acceder al Server configurado y al endpoint de Project Peer anunciado por el Host. Una invitación firmada no crea conectividad de red. Usa el mismo equipo, una LAN accesible o una VPN administrada; no se proporciona atravesamiento automático de Internet ni relay.

## Compatibilidad de producto y protocolo

Los componentes de TeamForge están pensados para avanzar como una sola línea de producto compatible, en lugar de mezclar de forma independiente versiones de Server, Project Peer, Launcher y el paquete.

La arquitectura actual separa:

- la autoridad de colaboración en tiempo real mediante el WebSocket del TeamForge Server configurado;
- la preparación inicial del proyecto y la coordinación de metadatos;
- la transferencia directa de datos de Project Peer;
- la integridad del Runtime Host/Guest y Launcher empaquetados.

La compatibilidad de versiones de protocolo o esquema solo es aditiva si la semántica existente sigue siendo compatible. Los números exactos seleccionados pertenecen a `release-contract.json`.

No mezcles manifiestos generados de Runtime/Launcher ni binarios de diferentes candidatos empaquetados solo porque muestren la misma versión de producto.

## Compatibilidad con Unity

La línea de producto Unity admitida actualmente es **Unity 6000.3**.

Un parche concreto del Editor solo puede considerarse validado si hay evidencias registradas para el código fuente o candidato previsto. No asumas que el parche más reciente de Unity está automáticamente probado o admitido.

La selección exacta de Editor registrada en las pruebas está en `release-contract.json`; las evidencias actuales se resumen en [STATUS.md](STATUS.md).

## Compatibilidad de desarrollo y runtime

Quienes desarrollan desde el código fuente deben usar los rangos de Node/npm/.NET/herramientas seleccionados en `release-contract.json` y en la configuración de bloqueo y compilación del repositorio.

Son **requisitos de código fuente y compilación**, no requisitos habituales de instalación para usuarios finales del flujo Host/Guest empaquetado, que utiliza componentes de runtime incluidos o autocontenidos según el contrato de versión actual.

Una nueva familia de versiones principales de Runtime o herramientas requiere una decisión explícita de compatibilidad y validación; no debe deducirse de una instalación exitosa en un solo equipo.

## Topología admitida

La topología actualmente admitida o prevista incluye:

- WebSocket del TeamForge Server configurado para la autoridad en tiempo real;
- transferencia HTTP directa de Project Peer en el mismo PC, una LAN accesible o una VPN administrada;
- modo explícito del mismo PC limitado a loopback;
- escucha autenticada fuera de loopback con un host concreto anunciado al Guest;
- flujo Host/Guest empaquetado para Windows con Runtime incluido y verificado.

Actualmente no se proporcionan como topología admitida:

- WebRTC / RTCDataChannel;
- ICE / STUN / TURN;
- atravesamiento automático de NAT;
- relay / cambio automático de transporte ante fallos;
- descubrimiento automático de peers;
- autoridad en tiempo real sin servidor o integrada;
- despliegue en Internet público no confiable con un sistema completo de identidad de usuarios y autorización.

`P2P` en la documentación actual de TeamForge significa **transferencia directa de datos de Project Peer**, no conectividad P2P automática por Internet.

## Tabla de plataformas

| Área | Estado de compatibilidad |
| --- | --- |
| Runtime incluido Windows x64 / Guest Launcher | Destino actual del paquete; el candidato exacto sigue sujeto a las condiciones de validación real de STATUS |
| Unity 6000.3 | Línea actual de Unity |
| Parche exacto de Unity registrado | Consulta `release-contract.json` + evidencias de STATUS |
| Otros parches de Unity 6000.3 | Requieren una nueva base de referencia y validación separada antes de declararlos probados |
| Launcher independiente para macOS/Linux | No está empaquetado como candidato actual equivalente |
| Docker/Compose | Opción de código fuente o servidor; no es el flujo Host empaquetado habitual ni una condición actual de lanzamiento |
| Authenticode | El estado de distribución y firma pertenece a STATUS y a la documentación del artefacto actual |

## Almacenamiento administrado en Windows del código actual

El código actual requiere una raíz administrada local fija NTFS/ReFS para el bloqueo de identidad del proyecto en Windows. Las raíces de red, no disponibles o no verificadas se rechazan. Es una condición del almacenamiento administrado de TeamForge, no un nuevo requisito general de los proyectos Unity. Consulta [STATUS.md](STATUS.md) para distinguir código fuente y candidato publicado, y la [implementación responsable](../project-peer/src/project-identity-lock.mjs).

## Afirmaciones de compatibilidad e historial

Los informes históricos de fases, trabajo y pruebas se aplican al código o artefacto que registraron. No deben usarse como evidencia actual de compatibilidad solo porque la versión visible se parezca a la línea actual.

Cuando importe la identidad exacta de los bytes, usa el nombre del archivo de la Release + SHA-256, no solo la versión de producto.
