# الحالة الحالية لـ TeamForge

[English](STATUS.md) · [كيف يعمل](HOW_IT_WORKS.ar.md)

_تمت مقارنة ترجمة المعاينة هذه مع الوثيقة الإنجليزية المرجعية `STATUS.md` بتاريخ 2026-10-04. للتفاصيل الدقيقة حول الأدلة وIssues والقرارات الحالية، تظل النسخة الإنجليزية هي المرجع._

> **معاينة عامة مبكرة: لا تستخدم TeamForge كنسخة وحيدة أو كوسيلة الاسترداد الوحيدة لأي Unity Project مهم.** احتفظ بنسخ احتياطية، ويفضل الاختبار على Projects يمكن الاستغناء عنها.

## الملخص الحالي

- خط المنتج: `0.5.1`
- Source lineage: `0.5.1-wp5.1-path-resilience`
- أحدث مرشح منشور: `v0.5.1-prealpha-wp5.1-r7`
- Source commit لـ r7: `d88ca4c41ecf1f9cc7aa5d349960f407f158ce9a`
- Windows ZIP: `Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r7-win-x64.zip`
- SHA-256: `a710acd3cd7189c3f44ae1b4ee46a15239313c850ad7f6982e3a58f2492a13aa`
- الهدف: Windows x64
- جاهزية الإصدار: **FIELD BLOCKED**
- خط Unity: `6000.3` (Editor الاختبار المسجل: `6000.3.21f1`)
- Realtime / Project Transfer / Project Manifest: **v1**

## حدود دليل r7

تم نشر r7 في 2026-10-03 من الـ commit أعلاه، ثم نجح في **Exact Release Validation** على Windows. أعادت الأتمتة تنزيل ZIP من Release، وتحققت من SHA-256 ومن كل hash في release manifest، وفكّت الحزمة من working directory مختلف إلى مسار جديد يحوي أحرفًا كورية ومسافات، ثم تحققت من Runtime/Node المضمّن، وسلوك Launcher بنمط fail-closed، وWindows path resilience، واختبارات junction حقيقية.

هذا **دليل آلي للحزمة المنشورة نفسها**. وفي اختبار فعلي لاحق باستخدام Host من r6 وGuest دقيق من r7، أعاد Guest استخدام managed root السابق بدون خطأ `destination_contains_unmanaged_content`، وبعد تغيير profile شبكة Host الموثوقة من Public إلى Private تقدّم التدفق عبر Publisher trust ثم Project receive ثم فتح Unity واتصال TeamForge كما أفاد المستخدم. ما زال ذلك لا يثبت exact r7 على الجهازين معًا، أو Fresh UAC بدون صلاحيات مرتفعة، أو Seed-port fallback، أو recovery بعد فقدان process فعليًا. لذلك تبقى الحالة FIELD BLOCKED.

يبقى دليل r5 الفعلي بتاريخ 2026-08-31 صالحًا للسيناريوهات التي نُفذت فعلًا: reconnect وlate join وreceive/resume وlong path وlock contention وSeed `5091`/transfer. نشر r7 لا يغير bytes أو النتائج التاريخية لـ r5.

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
