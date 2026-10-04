# Текущее состояние TeamForge

[English](STATUS.md) · [Как это работает](HOW_IT_WORKS.ru.md)

_Этот предварительный перевод сверён с каноническим английским `STATUS.md` от 2026-10-04. Для подробных доказательств, Issues и текущих решений источником истины остаётся английская версия._

> **Ранняя публичная предварительная версия: не используйте TeamForge как единственную копию или единственный способ восстановления важного Unity Project.** Сохраняйте резервные копии и по возможности тестируйте на Project, который можно удалить.

## Текущая сводка

- Линия продукта: `0.5.1`
- Source lineage: `0.5.1-wp5.1-path-resilience`
- Последний опубликованный кандидат: `v0.5.1-prealpha-wp5.1-r7`
- Source commit r7: `d88ca4c41ecf1f9cc7aa5d349960f407f158ce9a`
- Windows ZIP: `Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r7-win-x64.zip`
- SHA-256: `a710acd3cd7189c3f44ae1b4ee46a15239313c850ad7f6982e3a58f2492a13aa`
- Цель: Windows x64
- Готовность релиза: **FIELD BLOCKED**
- Линия Unity: `6000.3` (зафиксированный тестовый Editor: `6000.3.21f1`)
- Realtime / Project Transfer / Project Manifest: **v1**

## Граница доказательств r7

r7 опубликован 2026-10-03 из указанного выше commit и затем прошёл Windows **Exact Release Validation**. Автоматизация повторно скачала ZIP Release, проверила SHA-256 и каждый hash в release manifest, выполнила чистую распаковку в путь с корейскими символами и пробелами из другого рабочего каталога, а также проверила упакованный Runtime/Node, fail-closed поведение Launcher, Windows path resilience и реальные junction.

Это **автоматизированное доказательство для точного опубликованного пакета**. Оно ещё не доказывает Firewall/UAC на двух физических PC, реальную LAN-доступность, Project identity recovery после аварийной потери process или полный поток Host → Guest → realtime. Поэтому состояние остаётся FIELD BLOCKED.

Физические доказательства r5 от 2026-08-31 остаются действительными для реально выполненных тогда сценариев: reconnect, late join, receive/resume, long path, lock contention и Seed `5091`/transfer. Публикация r7 не меняет bytes или исторические результаты r5.

## Текущий охват

Presence, Selection, синхронизация Transform, базовые lock/ownership, поддерживаемые операции Same-Scene Hierarchy, прямой P2P Project transfer, UX диагностики/восстановления и Windows path resilience реализованы или стабилизируются. r7 также включает post-r5 Windows firewall onboarding, fallback при занятом/недоступном Seed port, Windows Project identity crash recovery, дополнительные diagnostics и SceneView feedback `TeamForge · Locked by <owner>`.

Общая синхронизация Component/Inspector, Prefab/общие Asset collaboration, постоянное server/session restart recovery и автоматический Internet NAT traversal/relay пока не поддерживаются.

## Оставшаяся физическая проверка

1. Чисто распаковать **точный r7** на двух Windows PC и проверить Firewall onboarding/UAC, узкие правила Private + `LocalSubnet` и их lifecycle.
2. Создать конфликт/недоступность предпочтительного Seed port; подтвердить реальную доступность endpoint, объявленного после fallback, а также Host Stop/Start и Fresh Guest transfer.
3. Смоделировать аварийную потерю process во время Project identity и подтвердить безопасное recovery, сохраняя fail closed для неоднозначных/конфликтующих identity.
4. Выполнить Fresh Host → Fresh Guest → Unity realtime smoke; проверить понятность foreign-lock feedback и его исчезновение после release/takeover.
5. Оставить #182 как наблюдение за периодическим CI без маскировки retry/skip; #79 остаётся UX follow-up для временного движения SceneView.

## Источники

Подробности возможностей, blocker и доказательств: [English STATUS](STATUS.md); точные версии/Runtime/Protocol: [`release-contract.json`](../release-contract.json); идентичность опубликованных bytes: [`builds/README.md`](../builds/README.md) и SHA-256 GitHub Release.
