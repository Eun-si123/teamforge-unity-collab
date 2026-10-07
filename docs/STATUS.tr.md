# TeamForge güncel durumu

[English](STATUS.md) · [Nasıl çalışır](HOW_IT_WORKS.tr.md)

_Bu önizleme çevirisi, 2026-10-07 tarihli kanonik İngilizce `STATUS.md` ile karşılaştırılmıştır. Ayrıntılı kanıtlar, Issues ve güncel kararlar için İngilizce sürüm esas alınır._

> **Erken genel önizleme: TeamForge'u önemli bir Unity Project için tek kopya veya tek kurtarma yöntemi olarak kullanmayın.** Yedek tutun ve mümkünse silinebilir test Projectleri kullanın.

## Güncel özet

- Ürün hattı: `0.5.1`
- Source lineage: `0.5.1-wp5.1-path-resilience`
- En yeni yayımlanmış aday: `v0.5.1-prealpha-wp5.1-r7`
- r7 Source commit: `d88ca4c41ecf1f9cc7aa5d349960f407f158ce9a`
- Windows ZIP: `Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r7-win-x64.zip`
- SHA-256: `a710acd3cd7189c3f44ae1b4ee46a15239313c850ad7f6982e3a58f2492a13aa`
- Hedef: Windows x64
- Release hazırlığı: **FIELD BLOCKED**
- Unity hattı: `6000.3` (kayıtlı test Editor: `6000.3.21f1`)
- Realtime / Project Transfer / Project Manifest: **v1**

## r7 kanıt sınırı

r7, yukarıdaki commit'ten 2026-10-03 tarihinde yayımlandı ve ardından Windows **Exact Release Validation** testini geçti. Otomasyon Release ZIP'ini yeniden indirdi; SHA-256 ve release manifest içindeki tüm dosya hashlerini doğruladı; farklı bir çalışma dizininden Korece karakter ve boşluk içeren yeni bir yola çıkardı; paketli Runtime/Node, Launcher fail-closed davranışı, Windows path resilience ve gerçek junction testlerini doğruladı.

Bu, **tam olarak yayımlanan paket için otomatik kanıttır**. Daha sonraki fiziksel testte r6 Host ve exact r7 Guest kullanıldı; mevcut managed root `destination_contains_unmanaged_content` olmadan yeniden kullanıldı. Güvenilen Host LAN profili Public'ten Private'a değiştirildikten sonra akış Publisher trust, Project receive ve Unity açılışı üzerinden kullanıcının bildirdiği TeamForge bağlantısına kadar ilerledi. Bu hâlâ iki PC'de exact r7, yükseltilmemiş yeni UAC onboarding, Seed port fallback veya anormal process kaybı sonrası fiziksel Project identity recovery kanıtı değildir. Bu nedenle FIELD BLOCKED durumu sürer.

2026-08-31 tarihli r5 fiziksel kanıtı, o gün gerçekten çalıştırılan reconnect, late join, receive/resume, long path, lock contention ve Seed `5091`/transfer senaryoları için geçerliliğini korur. r7'nın yayımlanması r5 byte'larını veya geçmiş sonuçları değiştirmez.

## Sonraki r7-on-Host engelleri ve birleştirilmemiş düzeltmeler

Sonraki fiziksel testler, keşfedilebilir Direct Project Peer yokken Host Ready görünmesine rağmen `baseline_unavailable`, mevcut doğrulanmış Project açılırken uzun yol kaynaklı `DirectoryNotFoundException` sorunlarını ortaya çıkardı. Source incelemesi ayrıca tek bir Project dizini Projects root olarak seçildiğinde iç içe UUID oluşma riskini belirledi.

2026-10-07 itibarıyla PR #209 birleştirilmemiştir. Düzeltmeler mevcut `main` Runtime içinde veya yayımlanmış r7 ZIP içinde değildir. Doğrulama, ayrı bir değişmez candidate ile exact-release/fiziksel testler gerektirir. Önceki karma r6/r7 PASS kendi kapsamını korur; durum FIELD BLOCKED olarak kalır.

[PR #209](https://github.com/Eun-si123/teamforge-unity-collab/pull/209) · [English evidence/status](https://eun-si123.github.io/teamforge-unity-collab/status/#later-r7-on-host-blockers-and-pending-source-fixes)

## Güncel kapsam

Presence, Selection, Transform eşitleme, temel lock/ownership, desteklenen Same-Scene Hierarchy işlemleri, doğrudan P2P Project transfer, tanılama/kurtarma UX'i ve Windows path resilience uygulanmış veya stabilizasyon aşamasındadır. r7 ayrıca post-r5 Windows firewall onboarding, meşgul/kullanılamayan Seed port fallback, Windows Project identity crash recovery, ek diagnostics ve SceneView `TeamForge · Locked by <owner>` geri bildirimini içerir.

Genel Component/Inspector eşitleme, Prefab/genel Asset collaboration, kalıcı server/session restart recovery ve otomatik Internet NAT traversal/relay şu anda desteklenmez.

## Kalan fiziksel doğrulama

1. **Tam r7** paketini iki Windows PC'ye temiz biçimde çıkarıp Firewall onboarding/UAC, Private + `LocalSubnet` ile sınırlı kurallar ve lifecycle'ı doğrulayın.
2. Tercih edilen Seed port için çakışma/kullanılamama durumu oluşturun; fallback sonrası gerçekten ilan edilen endpoint'in erişilebilir olduğunu, Host Stop/Start ve Fresh Guest transfer'i doğrulayın.
3. Project identity sırasında anormal process kaybı simüle edip güvenli recovery'yi ve belirsiz/çakışan identity durumlarında fail closed davranışını doğrulayın.
4. Fresh Host → Fresh Guest → Unity realtime smoke çalıştırın; foreign-lock geri bildiriminin anlaşılır olduğunu ve release/takeover sonrasında kaybolduğunu kontrol edin.
5. #182 aralıklı CI izlemesi olarak kalsın ve retry/skip ile gizlenmesin; #79 geçici SceneView hareketi için UX follow-up olarak kalsın.

## Kaynaklar

Yetenekler, blockerlar ve kanıt ayrıntıları için [English STATUS](STATUS.md); kesin seçimler için [`release-contract.json`](../release-contract.json); yayımlanan byte kimliği için [`builds/README.md`](../builds/README.md) ve GitHub Release SHA-256 kullanın.
