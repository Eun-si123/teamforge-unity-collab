# Текущее состояние TeamForge

[English](STATUS.md) · [Как это работает](HOW_IT_WORKS.ru.md)

_Этот предварительный перевод сверён с каноническим английским `STATUS.md` от 2026-11-11. Для подробных доказательств, Issues и текущих решений источником истины остаётся английская версия._

> **Ранняя публичная предварительная версия: не используйте TeamForge как единственную копию или единственный способ восстановления важного Unity Project.** Сохраняйте резервные копии и по возможности тестируйте на Project, который можно удалить.

> **2026-10-20 r9 field evidence:** Published r9 passed exact-release validation; user-reported two-PC basic collaboration and Guest reconnect PASS. Full recovery/negative field gate remains BLOCKED. [Current detail](https://github.com/Eun-si123/teamforge-unity-collab/blob/main/docs/STATUS.md).
> **2026-11-04 r10 user-reported two-PC field signal (not a package certification):** Basic Host/Guest collaboration, receive/reconnect, access-code rejection and one long destination were reported PASS; separate installed ZIP hashes were **not** checked on both machines. The published r10 ZIP passed [automated Exact Release Validation #41630492102](https://github.com/Eun-si123/teamforge-unity-collab/actions/runs/41630492102), but an actual Guest Wi-Fi/NIC outage was **NOT RUN** ([#457](https://github.com/Eun-si123/teamforge-unity-collab/issues/457)) and repeated Launcher startup exposed a defect (fixed in later source [#456](https://github.com/Eun-si123/teamforge-unity-collab/pull/456), **not** in r10). Full field readiness is **FIELD BLOCKED**. [Dated evidence](PHYSICAL_FIELD_EVIDENCE_2026-11-04_R10.md).

## Интеграция M1 в исходном коде: совместное редактирование Collider

M1 включается явно в исходниках и не входит в опубликованный ZIP r10. Поля trigger, center и size/radius компонентов BoxCollider/SphereCollider в сохранённой Scene без Prefab проходят реальный путь: проверка подписанных байтов Scene/meta → Server Authority → WebSocket → Unity Editor. После первоначального допуска непрерывные несохранённые изменения используют ledger сервера, общие revision/history и блокировку GameObject. Окно Collider Collaboration предоставляет условные Undo/Redo собственных изменений и ящик восстановления для просмотра и явной повторной отправки неподтверждённых локальных значений. Commit сервера, отчёт о применении в Editor и запись на диск — отдельные состояния.

Доказательства разделены на четыре этапа. **Реализация**: путь в исходниках существует; нужны финальная проверка и проверки PR. **Автоматическая проверка**: реальные тесты Node WebSocket успешной работы, конфликтов, дублей, late join, переподключения и подписанного источника проходят; итоговый SHA фиксируется в PR. **Интеграция Unity**: локально **NOT RUN**, поскольку здесь нет Unity Editor; ожидающий результат CI с одним настоящим Editor и peer Node не означает PASS. **Пакет и физические Windows-ПК**: M1 **NOT RUN**, новых публикаций или повышения готовности нет; исторические доказательства r10 и FIELD BLOCKED сохраняются.

Пределы: одна Scene на Session, 128 Session в памяти, 512 Collider/1536 свойств, конечные значения ±100/0–100. Неподдерживаемые поля остаются локальными. Добавление/удаление Component, Prefab, удаление владельца допущенного Collider или его предков требуют M2 и отклоняются в активном пути M1. Редакторы должны согласовать совместимую возможность и присоединиться к ней. Ledger остаётся в памяти после отключения всех peer, но **теряется при перезапуске сервера**; долговременное восстановление — M4. Два Unity Editor, late join трёх участников, сохранение/открытие, восемь Editor в течение часа и точный Windows-артефакт остаются отдельными непроведёнными проверками. Следующая цель — M2, жизненный цикл Component. См. [английский STATUS](STATUS.md) и [настройку запуска](../server/README.md).

## Текущая сводка

- Линия продукта: `0.5.1`
- Source lineage: `0.5.1-wp5.1-path-resilience`
- Последний опубликованный кандидат: `v0.5.1-prealpha-wp5.1-r10`
- Source commit r10: `693d3a9d647f9a511012f1ebba3209834531656e`
- Windows ZIP: `Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r10-win-x64.zip`
- SHA-256: `01afb269bd6235470bd75d1dda6a6c0119d0e21acea87087fe1115d0cd002f89`
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

## Последующие блокеры r7-on-Host и повторные испытания r8

Последующие физические тесты выявили `baseline_unavailable`, когда Host продолжал показывать Ready без обнаруживаемого Direct Project Peer, ошибку длинного пути `DirectoryNotFoundException` при открытии существующего проверенного Project. Проверка Source также выявила риск вложенных UUID при выборе каталога отдельного Project в качестве Projects root.

PR #209 объединён с `main` 2026-10-08; исправления **включены в опубликованный ZIP r8**. r8 прошёл Windows Exact Release Validation (запуск 38019297086), но повторные испытания на двух физических ПК Windows ещё нужны: снятие Ready при потере Direct Seed, повторное открытие Existing-Active через короткий путь и отказ при выборе каталога Project UUID как Projects root. Первоначальная причина исчезновения Seed не установлена. Прежний смешанный PASS r6/r7 действителен только в исходном объёме; статус остаётся **FIELD BLOCKED**.

[PR #209](https://github.com/Eun-si123/teamforge-unity-collab/pull/209) · [English evidence/status](https://eun-si123.github.io/teamforge-unity-collab/status/#later-r7-on-host-blockers-now-packaged-for-r8-retest)

## Текущий охват

Presence, Selection, синхронизация Transform, базовые lock/ownership, поддерживаемые операции Same-Scene Hierarchy, прямой P2P Project transfer, UX диагностики/восстановления и Windows path resilience реализованы или стабилизируются. r7 также включает post-r5 Windows firewall onboarding, fallback при занятом/недоступном Seed port, Windows Project identity crash recovery, дополнительные diagnostics и SceneView feedback `TeamForge · Locked by <owner>`.

Общая синхронизация Component/Inspector, Prefab/общие Asset collaboration, постоянное server/session restart recovery и автоматический Internet NAT traversal/relay пока не поддерживаются.

## Оставшаяся физическая проверка

1. Чисто распаковать **точный r10** на двух Windows PC и проверить Firewall onboarding/UAC, узкие правила Private + `LocalSubnet` и их lifecycle.
2. Создать конфликт/недоступность предпочтительного Seed port; подтвердить реальную доступность endpoint, объявленного после fallback, а также Host Stop/Start и Fresh Guest transfer.
3. Смоделировать аварийную потерю process во время Project identity и подтвердить безопасное recovery, сохраняя fail closed для неоднозначных/конфликтующих identity.
4. Выполнить Fresh Host → Fresh Guest → Unity realtime smoke; проверить понятность foreign-lock feedback и его исчезновение после release/takeover.
5. Оставить #182 как наблюдение за периодическим CI без маскировки retry/skip; #79 остаётся UX follow-up для временного движения SceneView.

## Источники

Подробности возможностей, blocker и доказательств: [English STATUS](STATUS.md); точные версии/Runtime/Protocol: [`release-contract.json`](../release-contract.json); идентичность опубликованных bytes: [`builds/README.md`](../builds/README.md) и SHA-256 GitHub Release.
