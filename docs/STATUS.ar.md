# الحالة الحالية لـ TeamForge

[English](STATUS.md) · [كيف يعمل](HOW_IT_WORKS.ar.md)

_تمت مقارنة ترجمة المعاينة هذه مع الوثيقة الإنجليزية المرجعية `STATUS.md` بتاريخ 2026-10-03. للتفاصيل الدقيقة حول الأدلة وIssues والقرارات الحالية، تظل النسخة الإنجليزية هي المرجع._

> **معاينة عامة مبكرة: لا تستخدم TeamForge كنسخة وحيدة أو كوسيلة الاسترداد الوحيدة لأي Unity Project مهم.** احتفظ بنسخ احتياطية، ويفضل الاختبار على Projects يمكن الاستغناء عنها.

## الملخص الحالي

- خط المنتج: `0.5.1`
- Source lineage: `0.5.1-wp5.1-path-resilience`
- أحدث مرشح منشور: `v0.5.1-prealpha-wp5.1-r6`
- Source commit لـ r6: `b479244a40ebf3f1e56787edd044d06b2d050e2b`
- Windows ZIP: `Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r6-win-x64.zip`
- SHA-256: `4a411e8769fd39a2cfa46feaf0bb6e711e8fbd1b5c0d98b5e74a93d7ebf3a64a`
- الهدف: Windows x64
- جاهزية الإصدار: **FIELD BLOCKED**
- خط Unity: `6000.3` (Editor الاختبار المسجل: `6000.3.21f1`)
- Realtime / Project Transfer / Project Manifest: **v1**

## حدود دليل r6

تم نشر r6 في 2026-10-03 من الـ commit أعلاه، ثم نجح في **Exact Release Validation** على Windows. أعادت الأتمتة تنزيل ZIP من Release، وتحققت من SHA-256 ومن كل hash في release manifest، وفكّت الحزمة من working directory مختلف إلى مسار جديد يحوي أحرفًا كورية ومسافات، ثم تحققت من Runtime/Node المضمّن، وسلوك Launcher بنمط fail-closed، وWindows path resilience، واختبارات junction حقيقية.

هذا **دليل آلي للحزمة المنشورة نفسها**. لا يثبت بعد Firewall/UAC على جهازين فعليين، أو الوصول الحقيقي عبر LAN، أو Project identity recovery بعد فقدان process بشكل غير طبيعي، أو التدفق الكامل Host → Guest → realtime. لذلك تبقى الحالة FIELD BLOCKED.

يبقى دليل r5 الفعلي بتاريخ 2026-08-31 صالحًا للسيناريوهات التي نُفذت فعلًا: reconnect وlate join وreceive/resume وlong path وlock contention وSeed `5091`/transfer. نشر r6 لا يغير bytes أو النتائج التاريخية لـ r5.

## النطاق الحالي

تم تنفيذ Presence وSelection ومزامنة Transform وlock/ownership الأساسي وعمليات Same-Scene Hierarchy المدعومة وP2P Project transfer المباشر وUX التشخيص/الاسترداد وWindows path resilience، أو أنها في مرحلة التثبيت. يتضمن r6 أيضًا Windows firewall onboarding بعد r5، وfallback عند انشغال/عدم توفر Seed port، وWindows Project identity crash recovery، وdiagnostics إضافية، وإشارة SceneView `TeamForge · Locked by <owner>`.

لا تزال مزامنة Component/Inspector العامة، وPrefab/Asset collaboration العامة، وpersistent server/session restart recovery، وInternet NAT traversal/relay التلقائي غير مدعومة حاليًا.

## التحقق الميداني المتبقي

1. فك **r6 نفسه** حديثًا على جهازي Windows واختبار Firewall onboarding/UAC، والقواعد الضيقة Private + `LocalSubnet` وlifecycle الخاص بها.
2. فرض تعارض/عدم توفر Seed port المفضل، والتأكد من إمكانية الوصول فعليًا إلى endpoint المعلن بعد fallback، مع Host Stop/Start وFresh Guest transfer.
3. محاكاة فقدان process غير طبيعي أثناء Project identity والتأكد من recovery آمن مع استمرار fail closed للهويات الغامضة/المتعارضة.
4. تنفيذ Fresh Host → Fresh Guest → Unity realtime smoke، والتأكد من وضوح foreign-lock feedback واختفائه بعد release/takeover.
5. إبقاء #182 للمراقبة المتقطعة في CI دون إخفائه بواسطة retry/skip؛ ويبقى #79 متابعة UX للحركة المؤقتة في SceneView.

## المصادر المرجعية

لتفاصيل القدرات وblockers والأدلة راجع [English STATUS](STATUS.md)؛ وللاختيارات الدقيقة [`release-contract.json`](../release-contract.json)؛ ولهوية bytes المنشورة [`builds/README.md`](../builds/README.md) وSHA-256 في GitHub Release.
