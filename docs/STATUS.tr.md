# TeamForge güncel durumu

[English](STATUS.md) · [Nasıl çalışır](HOW_IT_WORKS.tr.md)

_Bu önizleme çevirisi, 2026-11-11 tarihli kanonik İngilizce `STATUS.md` ile karşılaştırılmıştır. Ayrıntılı kanıtlar, Issues ve güncel kararlar için İngilizce sürüm esas alınır._

> **Erken genel önizleme: TeamForge'u önemli bir Unity Project için tek kopya veya tek kurtarma yöntemi olarak kullanmayın.** Yedek tutun ve mümkünse silinebilir test Projectleri kullanın.

> **2026-10-20 r9 field evidence:** Published r9 passed exact-release validation; user-reported two-PC basic collaboration and Guest reconnect PASS. Full recovery/negative field gate remains BLOCKED. [Current detail](https://github.com/Eun-si123/teamforge-unity-collab/blob/main/docs/STATUS.md).
> **2026-11-04 r10 user-reported two-PC field signal (not a package certification):** Basic Host/Guest collaboration, receive/reconnect, access-code rejection and one long destination were reported PASS; separate installed ZIP hashes were **not** checked on both machines. The published r10 ZIP passed [automated Exact Release Validation #41630492102](https://github.com/Eun-si123/teamforge-unity-collab/actions/runs/41630492102), but an actual Guest Wi-Fi/NIC outage was **NOT RUN** ([#457](https://github.com/Eun-si123/teamforge-unity-collab/issues/457)) and repeated Launcher startup exposed a defect (fixed in later source [#456](https://github.com/Eun-si123/teamforge-unity-collab/pull/456), **not** in r10). Full field readiness is **FIELD BLOCKED**. [Dated evidence](PHYSICAL_FIELD_EVIDENCE_2026-11-04_R10.md).

## Güncel özet

- Ürün hattı: `0.5.1`
- Source lineage: `0.5.1-wp5.1-path-resilience`
- En yeni yayımlanmış aday: `v0.5.1-prealpha-wp5.1-r10`
- r10 Source commit: `693d3a9d647f9a511012f1ebba3209834531656e`
- Windows ZIP: `Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r10-win-x64.zip`
- SHA-256: `01afb269bd6235470bd75d1dda6a6c0119d0e21acea87087fe1115d0cd002f89`
- Hedef: Windows x64
- Release hazırlığı: **FIELD BLOCKED**
- Unity hattı: `6000.3` (kayıtlı test Editor: `6000.3.21f1`)
- Realtime / Project Transfer / Project Manifest: **v1**

## Kaynak kodda M1 entegrasyonu: ortak Collider düzenleme

M1 kaynak kodda açıkça etkinleştirilir; yayımlanmış r10 ZIP içinde değildir. Kaydedilmiş, Prefab olmayan Scene içindeki BoxCollider/SphereCollider trigger, center ve size/radius değerlerini gerçek hat üzerinden paylaşır: imzalı Scene/meta baytlarının doğrulanması → Server Authority → WebSocket → Unity Editor. İlk kabulden sonra kaydetmeden yapılan sürekli düzenlemeler sunucu ledger'ını, ortak revision/history ve GameObject kilidini kullanır. Collider Collaboration penceresi kendi değişiklikleri için koşullu Undo/Redo ve onaylanmamış yerel değerleri inceleyip açıkça yeniden göndermek için kurtarma kutusu sunar. Sunucu commit'i, Editor uygulama raporu ve diske kayıt ayrı durumlardır.

Kanıt dört aşamadır. **Uygulama**: kaynak yolu vardır; son inceleme ve PR kontrolleri gereklidir. **Otomatik doğrulama**: gerçek Node WebSocket başarı, çakışma, yinelenen işlem, late join ve yeniden bağlantı testleri ile imzalı kaynak testleri geçer; son SHA sonuçları PR'da tutulur. **Unity entegrasyonu**: bu ortamda Unity Editor yoktur, yerelde **NOT RUN**; gerçek bir Editor ve Node peer içeren CI sonucunun beklenmesi PASS değildir. **Paket ve fiziksel Windows**: M1 **NOT RUN**, yeni yayım veya terfi yoktur; geçmiş r10 kanıtı ve FIELD BLOCKED korunur.

Sınırlar: Session başına bir Scene, bellekte tutulan 128 Session, 512 Collider/1536 özellik ve sonlu ±100/0–100 değerleri. Desteklenmeyen alanlar yerel kalır. Component ekleme/silme, Prefab ve kabul edilmiş Collider sahibini veya üst nesnelerini silme M2 gerektirir ve etkin M1 yolunda reddedilir. Düzenleyenler uyumlu yeteneği müzakere ederek katılmalıdır. Tüm peer'lar ayrıldıktan sonra ledger bellekte kalır, fakat **sunucu yeniden başlatılınca kaybolur**; kalıcı kurtarma M4 kapsamındadır. İki Unity Editor, üç kişilik late join, kaydetme/yeniden açma, sekiz Editor ile bir saat ve tam Windows paketi ayrı doğrulamalar olarak bekler. Sıradaki hedef M2 Component yaşam döngüsüdür. [İngilizce STATUS](STATUS.md) ve [çalıştırma ayarlarına](../server/README.md) bakın.

## r8 yayını ve kanıt sınırları

r8, 2026-10-10 tarihinde yayımlandı. Direct Seed durumunu doğrulayan, güvenilir Existing-Active açılışını sağlayan ve iç içe Project root seçimini reddeden PR #209 düzeltmelerini içerir. Yayımlanan ZIP, Windows Exact Release Validation testini (çalıştırma 38019297086) geçti; ancak **r8 henüz iki fiziksel Windows PC üzerinde test edilmedi**. Durum **FIELD BLOCKED** olarak kalıyor. Aşağıdaki r7 sonuçları tarihsel kayıtlardır ve r8 saha doğrulaması değildir. Daha sonra birleştirilen PR #217 ve #219, r8 ZIP içinde bulunmaz.

## r7 kanıt sınırı

r7, d88ca4c41ecf1f9cc7aa5d349960f407f158ce9a commit'inden 2026-10-03 tarihinde yayımlandı ve ardından Windows **Exact Release Validation** testini geçti. Otomasyon Release ZIP'ini yeniden indirdi; SHA-256 ve release manifest içindeki tüm dosya hashlerini doğruladı; farklı bir çalışma dizininden Korece karakter ve boşluk içeren yeni bir yola çıkardı; paketli Runtime/Node, Launcher fail-closed davranışı, Windows path resilience ve gerçek junction testlerini doğruladı.

Bu, **tam olarak yayımlanan paket için otomatik kanıttır**. Daha sonraki fiziksel testte r6 Host ve exact r7 Guest kullanıldı; mevcut managed root `destination_contains_unmanaged_content` olmadan yeniden kullanıldı. Güvenilen Host LAN profili Public'ten Private'a değiştirildikten sonra akış Publisher trust, Project receive ve Unity açılışı üzerinden kullanıcının bildirdiği TeamForge bağlantısına kadar ilerledi. Bu hâlâ iki PC'de exact r7, yükseltilmemiş yeni UAC onboarding, Seed port fallback veya anormal process kaybı sonrası fiziksel Project identity recovery kanıtı değildir. Bu nedenle FIELD BLOCKED durumu sürer.

2026-08-31 tarihli r5 fiziksel kanıtı, o gün gerçekten çalıştırılan reconnect, late join, receive/resume, long path, lock contention ve Seed `5091`/transfer senaryoları için geçerliliğini korur. r7'nın yayımlanması r5 byte'larını veya geçmiş sonuçları değiştirmez.

## Sonraki r7-on-Host engelleri ve r8 ile yeniden test

Sonraki fiziksel testler, keşfedilebilir Direct Project Peer yokken Host Ready görünmesine rağmen `baseline_unavailable`, mevcut doğrulanmış Project açılırken uzun yol kaynaklı `DirectoryNotFoundException` sorunlarını ortaya çıkardı. Source incelemesi ayrıca tek bir Project dizini Projects root olarak seçildiğinde iç içe UUID oluşma riskini belirledi.

PR #209, 2026-10-08 tarihinde `main` dalına birleştirildi; düzeltmeler **yayımlanan r8 ZIP içinde bulunuyor**. r8, Windows Exact Release Validation testini (çalıştırma 38019297086) geçti; ancak iki fiziksel Windows PC üzerinde yeniden test gerekiyor: Direct Seed kaybolunca Ready durumunun kaldırılması, Existing-Active projesinin kısa yol üzerinden yeniden açılması ve Project UUID dizininin Projects root olarak reddedilmesi. Seed kaybının ilk nedeni henüz doğrulanmadı. Önceki karma r6/r7 PASS yalnızca ilk kapsamı için geçerli; durum **FIELD BLOCKED** olarak kalıyor.

[PR #209](https://github.com/Eun-si123/teamforge-unity-collab/pull/209) · [English evidence/status](https://eun-si123.github.io/teamforge-unity-collab/status/#later-r7-on-host-blockers-now-packaged-for-r8-retest)

## Güncel kapsam

Presence, Selection, Transform eşitleme, temel lock/ownership, desteklenen Same-Scene Hierarchy işlemleri, doğrudan P2P Project transfer, tanılama/kurtarma UX'i ve Windows path resilience uygulanmış veya stabilizasyon aşamasındadır. r7 ayrıca post-r5 Windows firewall onboarding, meşgul/kullanılamayan Seed port fallback, Windows Project identity crash recovery, ek diagnostics ve SceneView `TeamForge · Locked by <owner>` geri bildirimini içerir.

Genel Component/Inspector eşitleme, Prefab/genel Asset collaboration, kalıcı server/session restart recovery ve otomatik Internet NAT traversal/relay şu anda desteklenmez.

## Kalan fiziksel doğrulama

1. **Tam r10** paketini iki Windows PC'ye temiz biçimde çıkarıp Firewall onboarding/UAC, Private + `LocalSubnet` ile sınırlı kurallar ve lifecycle'ı doğrulayın.
2. Tercih edilen Seed port için çakışma/kullanılamama durumu oluşturun; fallback sonrası gerçekten ilan edilen endpoint'in erişilebilir olduğunu, Host Stop/Start ve Fresh Guest transfer'i doğrulayın.
3. Project identity sırasında anormal process kaybı simüle edip güvenli recovery'yi ve belirsiz/çakışan identity durumlarında fail closed davranışını doğrulayın.
4. Fresh Host → Fresh Guest → Unity realtime smoke çalıştırın; foreign-lock geri bildiriminin anlaşılır olduğunu ve release/takeover sonrasında kaybolduğunu kontrol edin.
5. #182 aralıklı CI izlemesi olarak kalsın ve retry/skip ile gizlenmesin; #79 geçici SceneView hareketi için UX follow-up olarak kalsın.

## Kaynaklar

Yetenekler, blockerlar ve kanıt ayrıntıları için [English STATUS](STATUS.md); kesin seçimler için [`release-contract.json`](../release-contract.json); yayımlanan byte kimliği için [`builds/README.md`](../builds/README.md) ve GitHub Release SHA-256 kullanın.
