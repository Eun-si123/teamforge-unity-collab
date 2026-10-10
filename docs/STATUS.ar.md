# الحالة الحالية لـ TeamForge

[English](STATUS.md) · [كيف يعمل](HOW_IT_WORKS.ar.md)

_تمت مقارنة ترجمة المعاينة هذه مع الوثيقة الإنجليزية المرجعية `STATUS.md` بتاريخ 2026-10-08. للتفاصيل الدقيقة حول الأدلة وIssues والقرارات الحالية، تظل النسخة الإنجليزية هي المرجع._

> **معاينة عامة مبكرة: لا تستخدم TeamForge كنسخة وحيدة أو كوسيلة الاسترداد الوحيدة لأي Unity Project مهم.** احتفظ بنسخ احتياطية، ويفضل الاختبار على Projects يمكن الاستغناء عنها.

## الملخص الحالي

- خط المنتج: `0.5.1`
- Source lineage: `0.5.1-wp5.1-path-resilience`
- أحدث مرشح منشور: `v0.5.1-prealpha-wp5.1-r8`
- Source commit لـ r7: `4aff5756329c2fe013d78344859e0760c6a382ef`
- Windows ZIP: `Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r8-win-x64.zip`
- SHA-256: `3a003791043c067009250bf59da4d916e75eb6dc1b1ed0e93d54984a2d23eb21`
- الهدف: Windows x64
- جاهزية الإصدار: **FIELD BLOCKED**
- خط Unity: `6000.3` (Editor الاختبار المسجل: `6000.3.21f1`)
- Realtime / Project Transfer / Project Manifest: **v1**

## تحديث إصدار r8 وحدود الأدلة

نُشر r8 في 2026-10-10، ويتضمن إصلاحات PR #209 المتعلقة بصحة Direct Seed ومسار Existing-Active ومنع جذر المشروع المتداخل. نجح اختبار Windows Exact Release Validation للحزمة المنشورة (التشغيل 38019297086)، لكن **لم يُختبر r8 بعد على جهازَي Windows فعليين**؛ الحالة **FIELD BLOCKED**. تفاصيل r7 التالية سجل تاريخي، ولا تثبت نجاح إصلاحات r8. تغييرات PR #217 وPR #219 اللاحقة غير موجودة في حزمة r8.

## حدود دليل r7

تم نشر r7 في 2026-10-03 من commit d88ca4c41ecf1f9cc7aa5d349960f407f158ce9a، ثم نجح في **Exact Release Validation** على Windows. أعادت الأتمتة تنزيل ZIP من Release، وتحققت من SHA-256 ومن كل hash في release manifest، وفكّت الحزمة من working directory مختلف إلى مسار جديد يحوي أحرفًا كورية ومسافات، ثم تحققت من Runtime/Node المضمّن، وسلوك Launcher بنمط fail-closed، وWindows path resilience، واختبارات junction حقيقية.

هذا **دليل آلي للحزمة المنشورة نفسها**. وفي اختبار فعلي لاحق باستخدام Host من r6 وGuest دقيق من r7، أعاد Guest استخدام managed root السابق بدون خطأ `destination_contains_unmanaged_content`، وبعد تغيير profile شبكة Host الموثوقة من Public إلى Private تقدّم التدفق عبر Publisher trust ثم Project receive ثم فتح Unity واتصال TeamForge كما أفاد المستخدم. ما زال ذلك لا يثبت exact r7 على الجهازين معًا، أو Fresh UAC بدون صلاحيات مرتفعة، أو Seed-port fallback، أو recovery بعد فقدان process فعليًا. لذلك تبقى الحالة FIELD BLOCKED.

يبقى دليل r5 الفعلي بتاريخ 2026-08-31 صالحًا للسيناريوهات التي نُفذت فعلًا: reconnect وlate join وreceive/resume وlong path وlock contention وSeed `5091`/transfer. نشر r7 لا يغير bytes أو النتائج التاريخية لـ r5.

## عوائق r7-on-Host اللاحقة والإصلاحات غير المدمجة

كشفت الاختبارات الفعلية اللاحقة خطأ `baseline_unavailable` رغم استمرار Host في عرض Ready دون Direct Project Peer يمكن اكتشافه، وخطأ المسار الطويل `DirectoryNotFoundException` عند فتح Project موثّق موجود. وكشفت مراجعة Source أيضًا خطر تداخل UUID عند اختيار مجلد Project منفرد بوصفه Projects root.

اعتبارًا من 2026-10-08، دُمج PR #209 في `main`. الإصلاحات موجودة الآن في الشيفرة المصدرية فقط، وليست ضمن ZIP r7 المنشور. نجحت اختبارات CI وUnity وبوابة الجودة للفرع المحدث، لكن ما زال يلزم إصدار مرشح مستقل ثابت والتحقق من الحزمة والاختبار على جهازين. يظل نجاح r6/r7 المختلط مقصورًا على نطاقه السابق، والحالة **FIELD BLOCKED**.

[PR #209](https://github.com/Eun-si123/teamforge-unity-collab/pull/209) · [English evidence/status](https://eun-si123.github.io/teamforge-unity-collab/status/#later-r7-on-host-blockers-and-pending-source-fixes)

## النطاق الحالي

تم تنفيذ Presence وSelection ومزامنة Transform وlock/ownership الأساسي وعمليات Same-Scene Hierarchy المدعومة وP2P Project transfer المباشر وUX التشخيص/الاسترداد وWindows path resilience، أو أنها في مرحلة التثبيت. يتضمن r7 أيضًا Windows firewall onboarding بعد r5، وfallback عند انشغال/عدم توفر Seed port، وWindows Project identity crash recovery، وdiagnostics إضافية، وإشارة SceneView `TeamForge · Locked by <owner>`.

لا تزال مزامنة Component/Inspector العامة، وPrefab/Asset collaboration العامة، وpersistent server/session restart recovery، وInternet NAT traversal/relay التلقائي غير مدعومة حاليًا.

## التحقق الميداني المتبقي

1. فك **r7 نفسه** حديثًا على جهازي Windows واختبار Firewall onboarding/UAC، والقواعد الضيقة Private + `LocalSubnet` وlifecycle الخاص بها.
2. فرض تعارض/عدم توفر Seed port المفضل، والتأكد من إمكانية الوصول فعليًا إلى endpoint المعلن بعد fallback، مع Host Stop/Start وFresh Guest transfer.
3. محاكاة فقدان process غير طبيعي أثناء Project identity والتأكد من recovery آمن مع استمرار fail closed للهويات الغامضة/المتعارضة.
4. تنفيذ Fresh Host → Fresh Guest → Unity realtime smoke، والتأكد من وضوح foreign-lock feedback واختفائه بعد release/takeover.
5. إبقاء #182 للمراقبة المتقطعة في CI دون إخفائه بواسطة retry/skip؛ ويبقى #79 متابعة UX للحركة المؤقتة في SceneView.

## المصادر المرجعية

لتفاصيل القدرات وblockers والأدلة راجع [English STATUS](STATUS.md)؛ وللاختيارات الدقيقة [`release-contract.json`](../release-contract.json)؛ ولهوية bytes المنشورة [`builds/README.md`](../builds/README.md) وSHA-256 في GitHub Release.
