# TeamForge güncel durumu

[English](STATUS.md) · [Nasıl çalışır](HOW_IT_WORKS.tr.md)

_İngilizce belgenin son incelemesi: 2026-09-10 UTC. `main` üzerindeki r5 sonrası Windows ağ, tanılama ve Project kimliği güçlendirmeleri, yayımlanan r5 çıktısı ve 2026-08-31 tarihli birebir r5 fiziksel sonuçları karşılaştırılmıştır. Paket kanıtı ile daha yeni kaynak kodun kanıtı ayrı tutulur._

> **Erken Genel Önizleme — TeamForge'u önemli bir Unity projesinin tek kopyası veya tek kurtarma mekanizması olarak kullanmayın.** İlk WP5.1 Windows engelleri birebir r5 üzerinde kapsamlı fiziksel doğrulama aldı; ancak daha yeni `main` ağ/kimlik davranışları henüz tek bir birebir yeni aday paket olarak fiziksel PC'lerde doğrulanmadı. Yedekleri koruyun ve testlerde gözden çıkarılabilir projeleri tercih edin.

[English](STATUS.md), yetenekler ve yayıma hazır olma iddiaları için insanlarca okunabilir kanonik kaynaktır. Diğer belgeler rakip engel listeleri tutmak yerine buraya bağlanmalıdır. Kesin seçimler: [release-contract.json](../release-contract.json); bayt kimliği ve yerini yeni sürüme bırakan paketler: [builds/README.md](../builds/README.md); hata tartışmaları/tarihsel yeniden üretimler: GitHub Issues. Çevrilmemiş ayrıntılı belgeler İngilizce kalır.

## Genel görünüm

- Ürün serisi: `0.5.1`; kaynak kod çizgisi: `0.5.1-wp5.1-path-resilience`.
- Yayımlanmış en son paket adayı: `v0.5.1-prealpha-wp5.1-r5`.
- r5 kaynak/etiket commit'i: `a97b6ba5649e2888b909bf3c99c64acfd7042ba6`.
- Windows ZIP: `Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r5-win-x64.zip`.
- SHA-256: `5944abf2263502ee40f49d0ac2c8a9826a809dc4cd1b20c9edf82f94ba35f8cc`.
- Paket hedefi: Windows x64; yayın durumu: **FIELD BLOCKED**, saha doğrulama koşulları henüz tamamlanmadı.
- Unity serisi: `6000.3`; kayıtlı aday test Editor'ü: `6000.3.21f1`.
- Realtime Protocol, Project Transfer Protocol ve Project Manifest Schema: her biri **v1**.

## Kaynak kod ile paket adayı

#67, #68/#74, #69, #70 ve #71 için ilk WP5.1 düzeltmeleri PR #81 üzerinden birleştirildi. Yukarıdaki commit'ten üretilen r5, bunların yanında r4 sonrası Launcher **Save support bundle** bütünleştirmesini içerir.

2026-08-31 tarihinde birebir r5 iki fiziksel Windows PC'de denendi: kaydedilmiş Guest'in yeniden bağlanması, yeni Guest'in geç katılım Transform anlık görüntüsü, yinelenen alım durdurma/devam etme, uzun/derin yol execution alias devri ve eski kilit çekişmesinin korumalı çatışmasından kurtarma. Gerekli güvenlik duvarı izninden sonra Host Stop/Start ile Seed TCP `5091` yeniden bağlama ve gerçek Guest Project aktarımı da fiziksel olarak doğrulandı.

Bu senaryolar ilk r5 fiziksel tekrarını artık beklemiyor. Bu kanıt daha sonraki değişiklikleri r5'e katmaz, ürünü de genel olarak kurulabilir alpha yapmaz. Paket iddialarında r5 ve 2026-08-31 kanıtını kullanın; r5'i `main` ile bayt veya davranış bakımından eşdeğer saymayın. Eski metinler bekliyor dediği için kapanmış r5 senaryolarını yeniden açık göstermeyin. `main` yeni aday olacaksa değişmez yeni bir çıktı yayımlanmalı ve r5 sonrası eklenen davranış o birebir çıktıda sınanmalıdır.

## r5'te bulunmayan sonraki güçlendirmeler

- Windows LAN güvenlik duvarı kurulumu, açık kullanıcı ve UAC onayından sonra Private profili ve LocalSubnet ile sınırlı dar Coordinator/Seed gelen kuralları oluşturabilir; TeamForge'a ait kuralları uzlaştırır/temizler. r5 saha testi elle izin gerektiriyordu; yeni yol birebir paket fiziksel kanıtı ister.
- Tercih edilen/varsayılan Seed portu dolu veya kullanılamıyorsa, Windows bind bağlamındaki `EACCES` dahil, Host işletim sisteminin atadığı portla bir kez yeniden dener ve seçilen uç noktayı duyurur. Otomatik Windows Project Peer kapsamı vardır; davranış r5'ten yenidir.
- Project kimliği oluşturmayı sıraya alma ve Windows çökme kurtarması: işletim sistemine ait named-pipe canlı kilit ve eski yazıcılar için kalıcı uyumluluk bariyeri. Windows Node 22/24 çökme/eşzamanlılık testleri geçti; bu değişikliği içeren yayımlanmış bir paket henüz birebir fiziksel saha kanıtı almadı.
- Coordinator reddi temizliği, HTTP iptal/süre sınırları, gelişmiş Host tanılama bağlamı, WebSocket istemci rol günlükleri ve Launcher davetleriyle `TF1` bağlantı kodlarının daha açık ayrımı.

Bunlar kaynak/otomasyon olgularıdır, r5 paket davranışı değildir. Linux/macOS eski Project kimlik kilidi kurtarması da Windows'a özgü bu değişikliğin dışındadır.

## Yetenekler

| Alan | Kaynak durumu | Kanıt sınırı |
| --- | --- | --- |
| Bağlı kullanıcı Presence | Uygulandı/denendi | İki fiziksel PC temel akışı çalıştı; daha geniş dış test yararlı |
| Seçim/Editor farkındalığı | Uygulandı/denendi | Daha geniş dış test yararlı |
| Transform eşitleme | Uygulandı/kararlılaştırılıyor | r5 geç katılım ve çekişme kurtarması PASS; saha kapsamı/UX devam işi |
| Temel lock/ownership | Uygulandı/kararlılaştırılıyor | r5 çekişme/kurtarma PASS; başkasının kilidi varken düzenleme UX'i: #79 |
| Aynı Scene Hierarchy oluştur/sil/yeniden adlandır/üst öğe değiştir/sırala | Uygulandı/kararlılaştırılıyor | Desteklenen alt küme fiziksel olarak denendi; daha geniş kapsam yararlı |
| Project bootstrap/Collaboration Invite | Uygulandı/kararlılaştırılıyor | r5 kaydedilmiş Guest PASS; yeni kimlik kurtarmasında paket/saha kanıtı yok |
| Doğrudan P2P Project aktarımı | Uygulandı/kararlılaştırılıyor | r5 `5091` Stop/Start ve aktarım PASS; yeni firewall/port yollarında yeni paket saha kanıtı yok |
| Tanılama/kurtarma UX'i | Uygulandı/kararlılaştırılıyor | r5 gizliliği gözeten destek paketini içerir; sonraki iyileştirmeler r5'e göre yalnızca kaynakta |
| Windows yol dayanıklılığı/execution alias | Uygulandı/kararlılaştırılıyor | r5 uzun/derin devir PASS; kötü niyetli/ilgisiz alias reddi otomatik fail-closed kapsamı |
| Component/Inspector | Planlandı | Genel Component ekleme/kaldırma ve `SerializedProperty` eşitleme desteklenmiyor |
| Prefab/genel Asset işbirliği | Planlandı | Güncel desteklenen iş akışı değil |
| Kalıcı server/session yeniden başlatma kurtarması | Planlandı | Authority/session durumu bellekte |
| Otomatik Internet NAT geçişi/relay | Araştırma/gelecek | WebRTC, ICE, STUN, TURN, relay, discovery veya otomatik NAT geçişi yok |

## Birebir r5 fiziksel kapanışları

Bu sonuçlar ilk engellerin hâlâ fiziksel doğrulama beklediğini söyleyen eski metnin yerini alır.

| Issue | Sonuç ve bugünkü sınır |
| --- | --- |
| [#67](https://github.com/Eun-si123/teamforge-unity-collab/issues/67) | **PASS**: meşru ortak düzenleme/kaydetme → Guest Unity kapatma → aynı doğrulanmış Active Project'i açma → `guest_handoff_mismatch` olmadan realtime katılım. Yeni/doğrulanmamış kimlik reddi katı uygulama ve otomatik regresyonla korunur |
| [#68](https://github.com/Eun-si123/teamforge-unity-collab/issues/68) | **PASS**: yeni Guest yetkili Hierarchy/Transform/Lock ve sonraki Transform'u yanlış korumalı çatışma olmadan aldı. Geniş senaryolar yararlı; ilk engel kapandı |
| [#74](https://github.com/Eun-si123/teamforge-unity-collab/issues/74) | **PASS**: çekişmeyi kaybeden taraf yetkili duruma döndü; işbirliği kullanılabilir kaldı. Yabancı kilit UX'i ayrı #79 |
| [#69](https://github.com/Eun-si123/teamforge-unity-collab/issues/69) | **PASS**: Launcher alım sırasında defalarca zorla sonlandırıldı; doğrulanmış kısmi veri kullanılıp ilk CLR/uygulama hatası olmadan devam tamamlandı. Sonraki Runtime değişikliklerinde regresyon kapsamını koruyun |
| [#70](https://github.com/Eun-si123/teamforge-unity-collab/issues/70) | **r5 ÜRÜN HEDEFİ İÇİN KISMİ / KARARLI SEED İÇİN PASS**: Host Stop/Start TCP `5091`'e yeniden bağlandı; firewall izniyle gerçek aktarım geçti. Yeni otomatik kurulum ve port fallback birebir yeni paket saha kanıtı ister |
| [#71](https://github.com/Eun-si123/teamforge-unity-collab/issues/71) | **PASS**: uzun/derin hedef yol optimizasyonunu tetikledi, Unity açıldı ve işbirliği çalıştı. Kötü niyetli/ilgisiz/yeniden hedeflenmiş alias reddi otomatik fail-closed kanıtı olarak kalır |

Ayrıntılı zaman çizelgesi Issues'a, güncel yayın etkisi STATUS'a aittir.

## Otomatik ve yerel kanıt

PR #81 birleşmeden önce bütünleşik head, `docs/MAIN_PATCH_STATUS_2026-08-27.md` içindeki kapıları geçti:

- CI #216: Server, Project Peer, Launcher Runtime loader, Windows Launcher ve açık kaynak sözleşmesi **PASS**.
- Dependency Review #140 **PASS**.
- Unity Tests #73: Unity Lock Contention E2E, Unity Realtime Authority E2E, Realtime Authority Chaos E2E, Project Transfer Resume E2E **PASS**.
- Önceki yerel Unity Test Runner: **yerelde çalışabilen 143/143 test PASS**; yalnızca CI'da çalışan iki gerçek sunucu testi yerelde bilerek atlandı.
- Aynı makinede A/B çekişme kurtarması **PASS**; A/B/C geç katılım Hierarchy/Transform yakınsaması **PASS**, kayıtlı çalışmada sıfır korumalı çatışma.

Sonraki güçlendirmeler odaklı Project Peer/Launcher/Unity testleri ve normal kalite kapılarıyla denendi. Windows kimlik çökme/eşzamanlılık suite'i desteklenen Node 22/24 üzerinde geçti; kullanılamayan Seed portu regresyonu yeniden üretilmiş Windows ortamında tam Project Peer suite'ini geçti. Bunlar yeni kaynağa güveni artırır, düzeltmelerden önce yayımlanan baytlar için paket kanıtı oluşturmaz.

## İki fiziksel PC kanıtı

2026-08-22 temel akış: Host → imzalı davet → yeni Guest → kimlik doğrulama → doğrudan aktarım → Publisher güveni → doğrulanmış Active → Unity realtime; Presence/çift yönlü Transform; normal kilit çekişmesi; aynı Scene oluştur/adlandır/üst öğe değiştir/kardeş sırala/sil. Kaydetmeden Guest çıkış/açılış, yaşayan oturumdan Hierarchy/Transform/Lock durumunu geri aldı. Coordinator TCP kesintisi → retry → Unity'yi yeniden başlatmadan otomatik bağlanma.

2026-08-31'de birebir r5 ZIP/SHA çifti yukarıdaki hedef senaryoları iki fiziksel Windows PC'de kapattı. Seed `5091` Stop/Start ve gerçek LAN aktarımı da geçti; ilk firewall izni o sırada hâlâ elle veriliyordu.

## Kanıt sınırları

Sonuç yalnızca çalıştırılanı kanıtlar. Kaynak CI bir ZIP'i kanıtlamaz. Unity otomasyonu her SceneView girdi sırasını, Windows süreç koşulunu, LAN/firewall durumunu veya ikinci makine zamanlamasını üretmez. Tek makine testleri OS, ağ yığını, zamanlama ve donanımı paylaşır. r5 kanıtı sonraki `main`'i doğrulamaz. Sürüm bayt kimliği değildir; kesin dosya adı/SHA-256 gerekir. Kapanmış hata sonraki alt sistem değişikliklerine otomatik paket/saha kanıtı vermez. Tarihsel notlar kendi anlık görüntüleri için geçerlidir, güncel STATUS'u geçersiz kılmaz.

## Kalan yayın koşulları

Genel olarak kurulabilir alpha tanıtımından önce:

1. r5 #67/#68/#69/#71/#74 fiziksel kapanışlarını tamamlanmış olarak koruyun.
2. `main` dağıtılacaksa değişmez yeni bir aday yayımlayın.
3. Birebir yeni çıktıda ilk firewall kurulumu, dar kural kapsamı/yaşam döngüsü, dolu/kullanılamayan tercihli port fallback, duyurulan Seed erişimi, Host Stop/Start ve yeni Guest aktarımını sınayın.
4. Aynı çıktıda Windows kimliğinin süreç kaybı sonrası güvenli yeniden başlatma/kurtarmasını ve belirsiz/çelişkili kimlikte fail-closed kalmasını sınayın.
5. Yeni çıkarılmış Host → yeni Guest → realtime smoke testini yeni pakette yapın; r5 kanıtını varsayımla devralmayın.
6. Kesin aday adı/SHA/kaynak kimliğini ve yalnızca çalıştırılan senaryoları kaydedin.
7. Kurulum/güncelleme/kaldırma rehberlerini sürdürün; geniş güvenilirlik iddialarından önce proje yaratıcısı dışından test/inceleme alın.

Server süreç yeniden başlatması bugün **bağlantı kesme/fail-closed/yeni oturum kurtarmasıdır**, kalıcılık testi değildir: dayanıklı authority/session restart kurtarması uygulanmadı.

## Bilginin sahibi

Yetenek/engel: [English](STATUS.md); sürümler: [sözleşme](../release-contract.json); güncel/eski baytlar: [builds](../builds/README.md) + Release SHA; akış: [Nasıl çalışır](HOW_IT_WORKS.tr.md); plan: [ROADMAP](ROADMAP.md); yapı: [architecture](architecture.md); gerekçeler: [architecture-decisions](architecture-decisions.md); senaryolar: [TEST_LAB](TEST_LAB.md); hatalar: Issues; eski testler: tarihli kayıtlar. Çevrilmemiş ayrıntılar İngilizce kalır.
