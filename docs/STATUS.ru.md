# Текущее состояние TeamForge

[English](STATUS.md) · [Как это работает](HOW_IT_WORKS.ru.md)

_Этот предварительный перевод сверён с каноническим английским `STATUS.md` от 2026-10-08. Для подробных доказательств, Issues и текущих решений источником истины остаётся английская версия._

> **Ранняя публичная предварительная версия: не используйте TeamForge как единственную копию или единственный способ восстановления важного Unity Project.** Сохраняйте резервные копии и по возможности тестируйте на Project, который можно удалить.

## Текущая сводка

- Линия продукта: `0.5.1`
- Source lineage: `0.5.1-wp5.1-path-resilience`
- Последний опубликованный кандидат: `v0.5.1-prealpha-wp5.1-r8`
- Source commit r7: `4aff5756329c2fe013d78344859e0760c6a382ef`
- Windows ZIP: `Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r8-win-x64.zip`
- SHA-256: `3a003791043c067009250bf59da4d916e75eb6dc1b1ed0e93d54984a2d23eb21`
- Цель: Windows x64
- Готовность релиза: **FIELD BLOCKED**
- Линия Unity: `6000.3` (зафиксированный тестовый Editor: `6000.3.21f1`)
- Realtime / Project Transfer / Project Manifest: **v1**

## Выпуск r8 и границы проверки

r8 опубликован 2026-10-10 и включает исправления PR #209: проверку доступности Direct Seed, безопасный запуск проверенного Existing-Active и отказ от вложенного корня проекта. Опубликованный ZIP прошёл Windows Exact Release Validation (запуск 38019297086), однако **r8 ещё не проверен на двух физических ПК с Windows**. Статус остаётся **FIELD BLOCKED**. Описанные ниже результаты r7 относятся к прежней сборке и не являются полевой проверкой r8. PR #217 и #219 объединены позже и не входят в ZIP r8.

## Граница доказательств r7

r7 опубликован 2026-10-03 из commit d88ca4c41ecf1f9cc7aa5d349960f407f158ce9a и затем прошёл Windows **Exact Release Validation**. Автоматизация повторно скачала ZIP Release, проверила SHA-256 и каждый hash в release manifest, выполнила чистую распаковку в путь с корейскими символами и пробелами из другого рабочего каталога, а также проверила упакованный Runtime/Node, fail-closed поведение Launcher, Windows path resilience и реальные junction.

Это **автоматизированное доказательство для точного опубликованного пакета**. В последующем физическом тесте с Host r6 и точным Guest r7 существующий managed root был повторно использован без `destination_contains_unmanaged_content`; после смены профиля доверенной LAN на Host с Public на Private поток прошёл через Publisher trust, Project receive и запуск Unity до сообщённого пользователем подключения TeamForge. Это всё ещё не доказывает exact r7 на обоих PC, новое UAC-onboarding без повышенных прав, fallback порта Seed или физический Project identity recovery после аварийной потери process. Поэтому состояние остаётся FIELD BLOCKED.

Физические доказательства r5 от 2026-08-31 остаются действительными для реально выполненных тогда сценариев: reconnect, late join, receive/resume, long path, lock contention и Seed `5091`/transfer. Публикация r7 не меняет bytes или исторические результаты r5.

## Последующие блокеры r7-on-Host и ещё не объединённые исправления

Последующие физические тесты выявили `baseline_unavailable`, когда Host продолжал показывать Ready без обнаруживаемого Direct Project Peer, ошибку длинного пути `DirectoryNotFoundException` при открытии существующего проверенного Project. Проверка Source также выявила риск вложенных UUID при выборе каталога отдельного Project в качестве Projects root.

С 2026-10-08 PR #209 объединён с `main`. Исправления теперь есть в исходном коде, но **не входят** в опубликованный ZIP r7. CI, тесты Unity и Engineering Quality Gate обновлённого PR прошли; для подтверждения нужны отдельный неизменяемый кандидат, exact-release и физические испытания. Прежний смешанный PASS r6/r7 применим только к исходному сценарию; статус остаётся **FIELD BLOCKED**.

[PR #209](https://github.com/Eun-si123/teamforge-unity-collab/pull/209) · [English evidence/status](https://eun-si123.github.io/teamforge-unity-collab/status/#later-r7-on-host-blockers-and-pending-source-fixes)

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
